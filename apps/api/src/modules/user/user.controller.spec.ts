import { HttpStatus, StreamableFile } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserProfileResponseDto } from './dto/user-profile-response.dto.js';
import { matchesEtag, UserController } from './user.controller.js';
import { UserService, type StoredProfilePicture } from './user.service.js';

const PROFILE: UserProfileResponseDto = {
  id: '018f3a9e-0000-7000-8000-000000000001',
  displayName: 'Ada',
  pronouns: null,
  about: null,
  locale: 'de-CH',
  timezone: 'Europe/Zurich',
  includeInPrompts: true,
  hasPicture: true,
  pictureUpdatedAt: '2026-10-08T14:22:10.904Z',
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-08T14:22:10.904Z',
};

const ETAG = '"2026-10-08T14:22:10.904Z-2048"';

describe('matchesEtag', () => {
  it('matches an identical tag', () => {
    expect(matchesEtag(ETAG, ETAG)).toBe(true);
  });

  it('matches a tag the client weakened with W/', () => {
    expect(matchesEtag(`W/${ETAG}`, ETAG)).toBe(true);
  });

  it('matches one tag out of a list', () => {
    expect(matchesEtag(`"other", ${ETAG}`, ETAG)).toBe(true);
  });

  it('matches the wildcard', () => {
    expect(matchesEtag('*', ETAG)).toBe(true);
  });

  it('does not match a different tag', () => {
    expect(matchesEtag('"something-else"', ETAG)).toBe(false);
  });

  it('does not match a missing header', () => {
    expect(matchesEtag(undefined, ETAG)).toBe(false);
    expect(matchesEtag('', ETAG)).toBe(false);
  });
});

describe('UserController', () => {
  let controller: UserController;
  let service: UserService;
  let picture: StoredProfilePicture;

  function response(): Response {
    return {
      setHeader: vi.fn(),
      status: vi.fn(),
    } as unknown as Response;
  }

  function request(ifNoneMatch?: string): Request {
    return {
      headers: ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {},
    } as unknown as Request;
  }

  beforeEach(async () => {
    picture = {
      contentType: 'image/png',
      size: 2048,
      etag: ETAG,
      open: vi.fn().mockResolvedValue(Readable.from(Buffer.from([0x89]))),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        {
          provide: UserService,
          useValue: {
            find: vi.fn().mockResolvedValue(PROFILE),
            update: vi.fn().mockResolvedValue(PROFILE),
            uploadPicture: vi.fn().mockResolvedValue(PROFILE),
            openPicture: vi.fn().mockResolvedValue(picture),
            deletePicture: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    controller = module.get(UserController);
    service = module.get(UserService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates find to the service', async () => {
    await expect(controller.find()).resolves.toBe(PROFILE);
    expect(service.find).toHaveBeenCalledOnce();
  });

  it('delegates update to the service', async () => {
    await expect(controller.update({ displayName: 'Grace' })).resolves.toBe(
      PROFILE,
    );
    expect(service.update).toHaveBeenCalledWith({ displayName: 'Grace' });
  });

  it('delegates picture upload to the service, including a missing file', async () => {
    await controller.uploadPicture(undefined);

    // The "no file" rejection lives in one place rather than being duplicated
    // here, so the controller passes it straight through.
    expect(service.uploadPicture).toHaveBeenCalledWith(undefined);
  });

  it('delegates picture removal to the service', async () => {
    await expect(controller.deletePicture()).resolves.toBeUndefined();
    expect(service.deletePicture).toHaveBeenCalledOnce();
  });

  describe('findPicture', () => {
    it('streams the picture with its detected type and length', async () => {
      const res = response();

      const result = await controller.findPicture(request(), res);

      expect(result).toBeInstanceOf(StreamableFile);
      expect(result?.options).toMatchObject({
        type: 'image/png',
        length: 2048,
        disposition: 'inline',
      });
    });

    it('sets a validator and asks the client to revalidate', async () => {
      const res = response();

      await controller.findPicture(request(), res);

      expect(res.setHeader).toHaveBeenCalledWith('ETag', ETAG);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'private, max-age=0, must-revalidate',
      );
    });

    it('tells the browser not to sniff the type it was given', async () => {
      const res = response();

      await controller.findPicture(request(), res);

      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Content-Type-Options',
        'nosniff',
      );
    });

    it('answers a matching conditional request with 304 and no body', async () => {
      const res = response();

      const result = await controller.findPicture(request(ETAG), res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_MODIFIED);
      expect(result).toBeUndefined();
    });

    it('does not open the file for a request it answers with 304', async () => {
      await controller.findPicture(request(ETAG), response());

      expect(picture.open).not.toHaveBeenCalled();
    });

    it('still sends the picture when the client holds a stale tag', async () => {
      const result = await controller.findPicture(
        request('"an-older-tag"'),
        response(),
      );

      expect(result).toBeInstanceOf(StreamableFile);
    });
  });
});
