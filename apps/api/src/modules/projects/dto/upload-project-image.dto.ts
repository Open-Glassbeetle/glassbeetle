import { ApiProperty } from '@nestjs/swagger';

/**
 * Request payload schema for uploading a project image.
 *
 * Documentation only. The multipart body is parsed by
 * `PictureUploadInterceptor` and this class is never instantiated or
 * validated; it exists so `@ApiBody()` can describe the file part in the
 * OpenAPI document.
 */
export class UploadProjectImageDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description:
      'Project image file. Permitted formats: JPEG, PNG, WebP, GIF. SVG is forbidden.',
  })
  file!: Express.Multer.File;
}

