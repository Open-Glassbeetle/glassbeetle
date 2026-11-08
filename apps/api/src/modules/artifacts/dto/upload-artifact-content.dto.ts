import { ApiProperty } from '@nestjs/swagger';

/**
 * Request payload schema for uploading an artifact's file content.
 *
 * Documentation only. The multipart body is parsed by `ArtifactUploadInterceptor`
 * and this class is never instantiated; it exists so `@ApiBody()` can describe
 * the file upload part in Swagger/OpenAPI documentation.
 */
export class UploadArtifactContentDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description:
      'Artifact content file. May be any binary or text file up to 100 MiB.',
  })
  file!: Express.Multer.File;
}
