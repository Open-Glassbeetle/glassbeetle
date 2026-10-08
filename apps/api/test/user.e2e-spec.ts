import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness/index.js';

/**
 * A valid PNG as far as content sniffing is concerned: the 8-byte signature
 * followed by the start of an IHDR chunk. The stored type is derived from these
 * bytes, never from the multipart filename or declared content type.
 */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]),
  Buffer.alloc(32, 0x01),
]);

const GIF = Buffer.concat([
  Buffer.from('GIF89a', 'ascii'),
  Buffer.alloc(32, 0x02),
]);

describe('User profile endpoints (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(() => {
    testApp.reset();
  });

  function storedRows(): Array<Record<string, unknown>> {
    return testApp.db.all('SELECT * FROM user_profile');
  }

  describe('GET /api/v1/user', () => {
    it('provisions and returns the profile on a database that has none', async () => {
      expect(storedRows()).toHaveLength(0);

      const response = await testApp.request().get('/api/v1/user').expect(200);

      expect(response.body).toMatchObject({
        displayName: 'Test User',
        pronouns: null,
        about: null,
        includeInPrompts: true,
        hasPicture: false,
        pictureUpdatedAt: null,
      });
      expect(response.body.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(storedRows()).toHaveLength(1);
    });

    it('seeds a locale and time zone from the machine', async () => {
      const response = await testApp.request().get('/api/v1/user').expect(200);

      expect(typeof response.body.locale).toBe('string');
      expect(typeof response.body.timezone).toBe('string');
    });

    it('returns the same profile on repeated reads and never creates a second row', async () => {
      const first = await testApp.request().get('/api/v1/user').expect(200);
      const second = await testApp.request().get('/api/v1/user').expect(200);

      expect(second.body).toEqual(first.body);
      expect(storedRows()).toHaveLength(1);
    });

    it('never exposes the stored picture path or the singleton column', async () => {
      testApp.db.run(
        `INSERT INTO user_profile (id, singleton, picture_path, created_at, updated_at)
         VALUES (?, 1, ?, ?, ?)`,
        [
          '018f3a9e-0000-7000-8000-000000000001',
          'pictures/secret.png',
          '2026-10-01T08:00:00.000Z',
          '2026-10-01T08:00:00.000Z',
        ],
      );

      const response = await testApp.request().get('/api/v1/user').expect(200);

      expect(JSON.stringify(response.body)).not.toContain('pictures/');
      expect(response.body.picturePath).toBeUndefined();
      expect(response.body.singleton).toBeUndefined();
      expect(response.body.hasPicture).toBe(true);
    });

    it('emits unset fields as null rather than omitting them', async () => {
      const response = await testApp.request().get('/api/v1/user').expect(200);

      for (const field of [
        'pronouns',
        'about',
        'locale',
        'timezone',
        'pictureUpdatedAt',
      ]) {
        expect(field in response.body).toBe(true);
      }
    });
  });

  describe('PATCH /api/v1/user', () => {
    it('updates supplied fields and persists them', async () => {
      const updated = await testApp
        .request()
        .patch('/api/v1/user')
        .send({
          displayName: 'Ada',
          pronouns: 'she/her',
          about: 'Prefers short answers.',
          locale: 'en-GB',
          timezone: 'Europe/London',
          includeInPrompts: false,
        })
        .expect(200);

      expect(updated.body).toMatchObject({
        displayName: 'Ada',
        pronouns: 'she/her',
        about: 'Prefers short answers.',
        locale: 'en-GB',
        timezone: 'Europe/London',
        includeInPrompts: false,
      });

      const reread = await testApp.request().get('/api/v1/user').expect(200);
      expect(reread.body).toEqual(updated.body);
    });

    it('provisions the profile when the update is the first request', async () => {
      await testApp
        .request()
        .patch('/api/v1/user')
        .send({ displayName: 'Ada' })
        .expect(200);

      expect(storedRows()).toHaveLength(1);
    });

    it('clears a field on explicit null', async () => {
      await testApp
        .request()
        .patch('/api/v1/user')
        .send({ about: 'Something' })
        .expect(200);

      const response = await testApp
        .request()
        .patch('/api/v1/user')
        .send({ about: null })
        .expect(200);

      expect(response.body.about).toBeNull();
    });

    it('clears a field a form emptied to a blank string', async () => {
      await testApp
        .request()
        .patch('/api/v1/user')
        .send({ pronouns: 'she/her' })
        .expect(200);

      const response = await testApp
        .request()
        .patch('/api/v1/user')
        .send({ pronouns: '   ' })
        .expect(200);

      expect(response.body.pronouns).toBeNull();
    });

    it('treats an empty body as a no-op and leaves updatedAt alone', async () => {
      const before = await testApp.request().get('/api/v1/user').expect(200);

      const response = await testApp
        .request()
        .patch('/api/v1/user')
        .send({})
        .expect(200);

      expect(response.body).toEqual(before.body);
    });

    it('rejects an unresolvable time zone with the error envelope', async () => {
      const response = await testApp
        .request()
        .patch('/api/v1/user')
        .send({ timezone: 'Mars/Olympus_Mons' })
        .expect(400);

      expect(response.body).toMatchObject({
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Request validation failed',
        path: '/api/v1/user',
      });
      expect(response.body.details.join(' ')).toContain('IANA time zone');
    });

    it('rejects an unresolvable locale', async () => {
      await testApp
        .request()
        .patch('/api/v1/user')
        .send({ locale: 'not a locale at all' })
        .expect(400);
    });

    it('rejects an over-long about, which is a prompt budget', async () => {
      await testApp
        .request()
        .patch('/api/v1/user')
        .send({ about: 'a'.repeat(4001) })
        .expect(400);
    });

    it('rejects server-managed and unknown fields rather than ignoring them', async () => {
      for (const payload of [
        { id: '018f3a9e-0000-7000-8000-000000000001' },
        { createdAt: '2026-10-01T08:00:00.000Z' },
        { updatedAt: '2026-10-01T08:00:00.000Z' },
        { hasPicture: true },
        { picturePath: 'pictures/anything.png' },
        { email: 'ada@example.com' },
      ]) {
        await testApp.request().patch('/api/v1/user').send(payload).expect(400);
      }
    });
  });

  describe('profile picture', () => {
    async function upload(bytes: Buffer, filename = 'avatar.png') {
      return testApp
        .request()
        .put('/api/v1/user/picture')
        .attach('file', bytes, filename)
        .expect(200);
    }

    it('stores an upload and reports it on the profile', async () => {
      const response = await upload(PNG);

      expect(response.body.hasPicture).toBe(true);
      expect(response.body.pictureUpdatedAt).toBe(response.body.updatedAt);
      expect(JSON.stringify(response.body)).not.toContain('pictures/');
    });

    it('serves the bytes back with the type detected from the file', async () => {
      await upload(PNG);

      const response = await testApp
        .request()
        .get('/api/v1/user/picture')
        .responseType('blob')
        .expect(200);

      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['content-length']).toBe(String(PNG.length));
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.compare(response.body, PNG)).toBe(0);
    });

    it('ignores a lying filename and trusts the magic bytes', async () => {
      await upload(GIF, 'definitely-a-png.png');

      const response = await testApp
        .request()
        .get('/api/v1/user/picture')
        .responseType('blob')
        .expect(200);

      expect(response.headers['content-type']).toBe('image/gif');
    });

    it('offers a validator and answers a matching conditional request with 304', async () => {
      await upload(PNG);

      const first = await testApp
        .request()
        .get('/api/v1/user/picture')
        .responseType('blob')
        .expect(200);

      const etag = first.headers.etag;
      expect(etag).toBeTruthy();
      expect(first.headers['cache-control']).toBe(
        'private, max-age=0, must-revalidate',
      );

      const second = await testApp
        .request()
        .get('/api/v1/user/picture')
        .set('If-None-Match', etag)
        .expect(304);

      expect(second.body).toEqual({});
    });

    it('sends the picture again when the client holds a stale validator', async () => {
      await upload(PNG);

      await testApp
        .request()
        .get('/api/v1/user/picture')
        .set('If-None-Match', '"a-tag-from-an-older-picture"')
        .responseType('blob')
        .expect(200);
    });

    it('replaces the picture and changes the validator', async () => {
      await upload(PNG);
      const before = await testApp
        .request()
        .get('/api/v1/user/picture')
        .responseType('blob')
        .expect(200);

      await upload(GIF, 'second.gif');
      const after = await testApp
        .request()
        .get('/api/v1/user/picture')
        .responseType('blob')
        .expect(200);

      expect(after.headers.etag).not.toBe(before.headers.etag);
      expect(Buffer.compare(after.body, GIF)).toBe(0);
    });

    it('reports 404 with a stable code when no picture is stored', async () => {
      const response = await testApp
        .request()
        .get('/api/v1/user/picture')
        .expect(404);

      expect(response.body).toMatchObject({
        statusCode: 404,
        code: 'PICTURE_NOT_FOUND',
        path: '/api/v1/user/picture',
      });
    });

    it('reports 404 rather than 500 when the stored file is gone', async () => {
      await upload(PNG);
      testApp.db.run(
        'UPDATE user_profile SET picture_path = ? WHERE singleton = 1',
        ['pictures/never-written.png'],
      );

      const response = await testApp
        .request()
        .get('/api/v1/user/picture')
        .expect(404);

      expect(response.body.code).toBe('PICTURE_NOT_FOUND');
      expect(JSON.stringify(response.body)).not.toContain('never-written');
    });

    it('rejects a file that is not an image', async () => {
      const response = await testApp
        .request()
        .put('/api/v1/user/picture')
        .attach('file', Buffer.from('<svg xmlns="..."></svg>'), 'x.svg')
        .expect(400);

      expect(response.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('rejects a request carrying no file', async () => {
      const response = await testApp
        .request()
        .put('/api/v1/user/picture')
        .expect(400);

      expect(response.body.code).toBe('MISSING_FILE');
    });

    it('removes the picture and then reports no picture', async () => {
      await upload(PNG);

      await testApp.request().delete('/api/v1/user/picture').expect(204);

      const profile = await testApp.request().get('/api/v1/user').expect(200);
      expect(profile.body.hasPicture).toBe(false);
      expect(profile.body.pictureUpdatedAt).toBeNull();

      await testApp.request().get('/api/v1/user/picture').expect(404);
    });

    it('is idempotent about removal', async () => {
      await testApp.request().delete('/api/v1/user/picture').expect(204);
      await testApp.request().delete('/api/v1/user/picture').expect(204);
    });
  });

  describe('the singleton has no collection semantics', () => {
    it('offers no way to create a second profile', async () => {
      await testApp.request().post('/api/v1/user').send({}).expect(404);
    });

    it('offers no way to delete the profile', async () => {
      await testApp.request().delete('/api/v1/user').expect(404);
    });

    it('offers no profile addressable by id', async () => {
      await testApp
        .request()
        .get('/api/v1/user/018f3a9e-0000-7000-8000-000000000001')
        .expect(404);
    });

    it('offers no users collection', async () => {
      await testApp.request().get('/api/v1/users').expect(404);
    });
  });
});
