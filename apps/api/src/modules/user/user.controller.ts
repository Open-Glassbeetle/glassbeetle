import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Put,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiResponse,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiErrorResponseDto } from '../../common/http/api-error.js';
import { PictureUploadInterceptor } from '../../common/http/picture-upload.interceptor.js';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto.js';
import { UploadUserPictureDto } from './dto/upload-user-picture.dto.js';
import { UserProfileResponseDto } from './dto/user-profile-response.dto.js';
import { UserService } from './user.service.js';

/**
 * Whether a conditional request's `If-None-Match` covers this entity tag.
 *
 * The header may carry several tags and may weaken them with a `W/` prefix, so
 * a plain equality check would miss a revalidation a client legitimately sent
 * and resend the whole image.
 */
export function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) {
    return false;
  }

  if (header.trim() === '*') {
    return true;
  }

  const strip = (value: string): string => value.trim().replace(/^W\//, '');

  return header.split(',').some((candidate) => strip(candidate) === etag);
}

/**
 * Routes for `/user`: the profile of the person this installation belongs to.
 *
 * A singleton, not a collection: there is no id in the path and no list
 * endpoint, because the application is single-user and a path that could name
 * a second person is the first step towards an owner column on every table.
 *
 * The picture download is the one endpoint in the API that writes response
 * headers itself — `ETag`, `Cache-Control` and `nosniff` — since the picture
 * URL is stable across replacements and would otherwise be either
 * permanently cached or never cached.
 *
 * @see `docs/user-profile.md`
 */
@ApiTags('user')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * `GET /user` — the profile, seeded on first read.
   *
   * Cannot 404: there is no sign-up, so the service creates the row if it does
   * not exist yet.
   */
  @Get()
  @ApiOperation({
    summary: 'Retrieve the user profile',
    description: `Retrieves the profile of the person this installation belongs to.

Always succeeds. There is no sign-up and no account, so there is no state in which the application holds data but no user: the profile is created on first read, seeded with the operating system account name, locale and time zone. Those are starting values, not fixed ones — the first update replaces them and nothing re-seeds afterwards.`,
  })
  @ApiOkResponse({
    description: 'The user profile',
    type: UserProfileResponseDto,
  })
  async find(): Promise<UserProfileResponseDto> {
    return this.userService.find();
  }

  /**
   * `PATCH /user` — partial update.
   *
   * Locale and time zone are validated against the platform's own Intl data,
   * so an unresolvable value is a 400 rather than a stored string no client can
   * format with.
   */
  @Patch()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update the user profile',
    description: `Applies partial updates to the profile (PATCH). Only supplied fields are updated; an explicit null, or a string of only whitespace, clears a field.

An empty body is an idempotent no-op and leaves \`updatedAt\` untouched.`,
  })
  @ApiOkResponse({
    description: 'The updated user profile',
    type: UserProfileResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Request validation failed (e.g. an unresolvable locale or time zone, an over-long field, or a client-supplied server-managed field)',
    type: ApiErrorResponseDto,
  })
  async update(
    @Body() dto: UpdateUserProfileDto,
  ): Promise<UserProfileResponseDto> {
    return this.userService.update(dto);
  }

  /**
   * `GET /user/picture` — the stored picture, with revalidation.
   *
   * Sets the validators before deciding what to send, so a 304 carries the same
   * `ETag` as the 200 would. `nosniff` is set because the body is user-supplied
   * bytes rendered inside the desktop webview.
   *
   * Returns `undefined` for a conditional hit, which is how a Nest handler
   * produces a bodyless 304; the `StreamableFile` otherwise streams the file
   * rather than buffering it.
   *
   * @throws NotFoundException (404) when no picture is stored, or the recorded
   * file is missing from the storage root.
   */
  @Get('picture')
  @ApiOperation({
    summary: 'Download the user profile picture',
    description: `Serves the stored profile picture.

The content type is detected from the file's own bytes rather than from anything the uploading client claimed. The URL is stable across replacements, so the response carries an \`ETag\` and revalidates: a conditional request with a matching \`If-None-Match\` gets \`304 Not Modified\`. \`pictureUpdatedAt\` from the profile also works as a cache-busting query parameter for clients that would rather not wait for the round trip.`,
  })
  @ApiProduces('image/jpeg', 'image/png', 'image/webp', 'image/gif')
  @ApiOkResponse({
    description: 'The stored profile picture',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiResponse({
    status: HttpStatus.NOT_MODIFIED,
    description: 'The client already holds this picture',
  })
  @ApiNotFoundResponse({
    description:
      'No picture is stored, or the stored file is missing from the storage root',
    type: ApiErrorResponseDto,
  })
  async findPicture(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | undefined> {
    const picture = await this.userService.openPicture();

    res.setHeader('ETag', picture.etag);
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (matchesEtag(req.headers['if-none-match'], picture.etag)) {
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }

    return new StreamableFile(await picture.open(), {
      type: picture.contentType,
      length: picture.size,
      // No filename: the stored name is a generated UUIDv7 and the uploaded
      // one was discarded, so there is nothing truthful to put in it.
      disposition: 'inline',
    });
  }

  /**
   * `PUT /user/picture` — replace the picture.
   *
   * Passes the file straight through; the service rejects a missing, oversized
   * or non-image upload and deletes the file it replaced.
   */
  @Put('picture')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(PictureUploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload the user profile picture',
    description:
      'Uploads the profile picture (PUT replaces any existing one, and deletes the file it replaced). Only JPEG, PNG, WebP and GIF are permitted. SVG is excluded to prevent stored XSS. File size is bounded by configuration.',
  })
  @ApiBody({
    description:
      'Profile picture image file (JPEG, PNG, WebP, or GIF up to the configured maximum size)',
    type: UploadUserPictureDto,
  })
  @ApiOkResponse({
    description: 'Picture uploaded and profile updated',
    type: UserProfileResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'No file uploaded or file is empty',
    type: ApiErrorResponseDto,
  })
  @ApiUnsupportedMediaTypeResponse({
    description:
      'Unsupported media type (non-image or SVG); detected type is not permitted',
    type: ApiErrorResponseDto,
  })
  @ApiPayloadTooLargeResponse({
    description: 'Uploaded file exceeds the configured maximum size',
    type: ApiErrorResponseDto,
  })
  async uploadPicture(
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<UserProfileResponseDto> {
    return this.userService.uploadPicture(file);
  }

  /**
   * `DELETE /user/picture` — remove the picture.
   *
   * Idempotent, and always 204: with no id in the path there is nothing that
   * could be absent.
   */
  @Delete('picture')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove the user profile picture',
    description:
      'Deletes the profile picture and unlinks the stored file. Idempotent: removing a picture when none is stored still returns 204 No Content.',
  })
  @ApiNoContentResponse({
    description: 'Picture removed, or no picture was stored',
  })
  async deletePicture(): Promise<void> {
    await this.userService.deletePicture();
  }
}
