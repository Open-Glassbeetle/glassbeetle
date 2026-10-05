import { ApiProperty } from '@nestjs/swagger';

/**
 * Request payload schema for uploading an agent profile picture.
 */
export class UploadAgentPictureDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description:
      'Profile picture image file. Permitted formats: JPEG, PNG, WebP, GIF. SVG is forbidden.',
  })
  file!: Express.Multer.File;
}
