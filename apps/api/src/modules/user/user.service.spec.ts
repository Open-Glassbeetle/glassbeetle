import { NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfigService } from '../../config/app-config.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { FileNotFoundError } from '../../file-storage/file-storage.errors.js';
import type { FileStorageService } from '../../file-storage/file-storage.service.js';
import { UserService } from './user.service.js';

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

function multerFile(buffer: Buffer): Express.Multer.File {
  return { buffer, originalname: 'whatever.png' } as Express.Multer.File;
}

describe('UserService', () => {
  let db: DatabaseService;
  let fileStorage: FileStorageService;
  let config: AppConfigService;
  let service: UserService;

  beforeEach(() => {
    db = new DatabaseService();
    db.connect(':memory:');

    fileStorage = {
      write: vi.fn().mockResolvedValue({
        reference: 'pictures/018f3a9e-0000-7000-8000-000000000099.png',
        size: PNG_BYTES.length,
        contentType: 'image/png',
      }),
      delete: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockResolvedValue({
        size: 2048,
        contentType: 'image/png',
        modifiedAt: new Date(),
        createdAt: new Date(),
      }),
      createReadStream: vi.fn().mockResolvedValue(Readable.from(PNG_BYTES)),
    } as unknown as FileStorageService;

    config = {
      maxPictureSizeBytes: 5 * 1024 * 1024,
      defaultUserName: 'Ada',
    } as AppConfigService;

    service = new UserService(db, fileStorage, config);
  });

  afterEach(() => {
    db.close();
  });

  function storedRows(): Array<Record<string, unknown>> {
    return db.all('SELECT * FROM user_profile');
  }

  describe('find', () => {
    it('provisions the profile on first read instead of reporting that none exists', async () => {
      expect(storedRows()).toHaveLength(0);

      const profile = await service.find();

      expect(profile.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(storedRows()).toHaveLength(1);
    });

    it('seeds the configured name, and a locale and time zone from the machine', async () => {
      const profile = await service.find();

      expect(profile.displayName).toBe('Ada');
      expect(profile.locale).toBeTruthy();
      expect(profile.timezone).toBeTruthy();
    });

    it('starts with prompt sharing enabled and nothing else set', async () => {
      const profile = await service.find();

      expect(profile.includeInPrompts).toBe(true);
      expect(profile.pronouns).toBeNull();
      expect(profile.about).toBeNull();
      expect(profile.hasPicture).toBe(false);
      expect(profile.pictureUpdatedAt).toBeNull();
    });

    it('returns the same profile on every later read', async () => {
      const first = await service.find();
      const second = await service.find();

      expect(second).toEqual(first);
      expect(storedRows()).toHaveLength(1);
    });

    it('does not re-seed a name the user has since changed', async () => {
      await service.update({ displayName: 'Grace' });

      expect((await service.find()).displayName).toBe('Grace');
    });

    it('keeps a name the user cleared cleared', async () => {
      await service.find();
      await service.update({ displayName: null });

      expect((await service.find()).displayName).toBeNull();
      expect(storedRows()).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('applies supplied fields and leaves the rest alone', async () => {
      const before = await service.find();

      const updated = await service.update({
        pronouns: 'she/her',
        about: 'Works on Glassbeetle.',
      });

      expect(updated.pronouns).toBe('she/her');
      expect(updated.about).toBe('Works on Glassbeetle.');
      expect(updated.displayName).toBe(before.displayName);
      expect(updated.id).toBe(before.id);
    });

    it('persists what it returns', async () => {
      await service.update({ locale: 'en-GB', includeInPrompts: false });

      const reread = await service.find();
      expect(reread.locale).toBe('en-GB');
      expect(reread.includeInPrompts).toBe(false);
    });

    it('treats an empty payload as a no-op and does not touch updatedAt', async () => {
      const before = await service.find();

      const updated = await service.update({});

      expect(updated).toEqual(before);
    });

    it('provisions the profile when the first request is the update', async () => {
      const updated = await service.update({ displayName: 'Grace' });

      expect(updated.displayName).toBe('Grace');
      expect(storedRows()).toHaveLength(1);
    });

    it('never creates a second row', async () => {
      await service.update({ displayName: 'Grace' });
      await service.update({ displayName: 'Ada' });

      expect(storedRows()).toHaveLength(1);
    });
  });

  describe('uploadPicture', () => {
    it('stores the file and records it on the profile', async () => {
      const profile = await service.uploadPicture(multerFile(PNG_BYTES));

      expect(fileStorage.write).toHaveBeenCalledWith(
        'pictures',
        PNG_BYTES,
        expect.objectContaining({
          allowedMimeTypes: expect.arrayContaining(['image/png']),
        }),
      );
      expect(profile.hasPicture).toBe(true);
      expect(profile.pictureUpdatedAt).toBe(profile.updatedAt);
    });

    it('never exposes the stored path', async () => {
      const profile = (await service.uploadPicture(
        multerFile(PNG_BYTES),
      )) as Record<string, unknown>;

      expect(Object.values(profile)).not.toContain(
        'pictures/018f3a9e-0000-7000-8000-000000000099.png',
      );
    });

    it('deletes the file it replaced', async () => {
      await service.uploadPicture(multerFile(PNG_BYTES));
      vi.mocked(fileStorage.write).mockResolvedValue({
        reference: 'pictures/018f3a9e-0000-7000-8000-000000000100.png',
        size: PNG_BYTES.length,
        contentType: 'image/png',
      });

      await service.uploadPicture(multerFile(PNG_BYTES));

      expect(fileStorage.delete).toHaveBeenCalledWith(
        'pictures/018f3a9e-0000-7000-8000-000000000099.png',
      );
    });

    it('rejects a file that is not an image', async () => {
      await expect(
        service.uploadPicture(multerFile(Buffer.from('plain text'))),
      ).rejects.toMatchObject({
        response: { code: 'UNSUPPORTED_MEDIA_TYPE' },
      });
    });

    it('rejects a missing file', async () => {
      await expect(service.uploadPicture(undefined)).rejects.toMatchObject({
        response: { code: 'MISSING_FILE' },
      });
    });

    it('does not provision a profile for a request it rejects', async () => {
      await expect(service.uploadPicture(undefined)).rejects.toThrow();

      expect(storedRows()).toHaveLength(0);
    });
  });

  describe('openPicture', () => {
    it('reports 404 when no picture is stored', async () => {
      await expect(service.openPicture()).rejects.toMatchObject({
        response: { code: 'PICTURE_NOT_FOUND' },
      });
      await expect(service.openPicture()).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('describes the stored picture from the file itself', async () => {
      await service.uploadPicture(multerFile(PNG_BYTES));

      const picture = await service.openPicture();

      expect(picture.contentType).toBe('image/png');
      expect(picture.size).toBe(2048);
    });

    it('builds an entity tag from when the picture last changed', async () => {
      const profile = await service.uploadPicture(multerFile(PNG_BYTES));

      const picture = await service.openPicture();

      expect(picture.etag).toBe(`"${profile.pictureUpdatedAt}-2048"`);
    });

    it('changes the entity tag when the picture is replaced', async () => {
      await service.uploadPicture(multerFile(PNG_BYTES));
      const before = await service.openPicture();

      vi.mocked(fileStorage.stat).mockResolvedValue({
        size: 4096,
        contentType: 'image/webp',
        modifiedAt: new Date(),
        createdAt: new Date(),
      });
      await service.uploadPicture(multerFile(PNG_BYTES));
      const after = await service.openPicture();

      expect(after.etag).not.toBe(before.etag);
    });

    it('opens the stream only when asked', async () => {
      await service.uploadPicture(multerFile(PNG_BYTES));

      const picture = await service.openPicture();
      expect(fileStorage.createReadStream).not.toHaveBeenCalled();

      await picture.open();
      expect(fileStorage.createReadStream).toHaveBeenCalledWith(
        'pictures/018f3a9e-0000-7000-8000-000000000099.png',
      );
    });

    it('reports 404, not 500, when the row names a file storage no longer holds', async () => {
      await service.uploadPicture(multerFile(PNG_BYTES));
      vi.mocked(fileStorage.stat).mockRejectedValue(
        new FileNotFoundError('pictures/gone.png'),
      );

      await expect(service.openPicture()).rejects.toMatchObject({
        response: { code: 'PICTURE_NOT_FOUND' },
      });
    });

    it('does not repeat the storage reference in the error it reports', async () => {
      await service.uploadPicture(multerFile(PNG_BYTES));
      vi.mocked(fileStorage.stat).mockRejectedValue(
        new FileNotFoundError('pictures/gone.png'),
      );

      await expect(service.openPicture()).rejects.toMatchObject({
        response: { message: 'No profile picture is stored' },
      });
    });
  });

  describe('deletePicture', () => {
    it('clears both picture columns and deletes the file', async () => {
      await service.uploadPicture(multerFile(PNG_BYTES));

      await service.deletePicture();

      const profile = await service.find();
      expect(profile.hasPicture).toBe(false);
      expect(profile.pictureUpdatedAt).toBeNull();
      expect(fileStorage.delete).toHaveBeenCalledWith(
        'pictures/018f3a9e-0000-7000-8000-000000000099.png',
      );
    });

    it('is idempotent when no picture is stored', async () => {
      await expect(service.deletePicture()).resolves.toBeUndefined();
      await expect(service.deletePicture()).resolves.toBeUndefined();
      expect(fileStorage.delete).not.toHaveBeenCalled();
    });

    it('succeeds even when the file cannot be deleted, because the profile is already correct', async () => {
      await service.uploadPicture(multerFile(PNG_BYTES));
      vi.mocked(fileStorage.delete).mockRejectedValue(
        new Error('Filesystem I/O error'),
      );

      await expect(service.deletePicture()).resolves.toBeUndefined();
      expect((await service.find()).hasPicture).toBe(false);
    });
  });

  describe('without a configured name', () => {
    it('falls back to the operating system account', async () => {
      const bare = new UserService(db, fileStorage, {
        maxPictureSizeBytes: 5 * 1024 * 1024,
        defaultUserName: null,
      } as AppConfigService);

      expect((await bare.find()).displayName).toBeTruthy();
    });
  });
});
