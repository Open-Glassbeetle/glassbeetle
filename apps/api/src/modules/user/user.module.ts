import { Module } from '@nestjs/common';
import { PictureUploadInterceptor } from '../../common/http/picture-upload.interceptor.js';
import { UserController } from './user.controller.js';
import { UserService } from './user.service.js';

/**
 * Wires the `/user` singleton resource.
 *
 * Exports {@link UserService} so other features can read the profile's
 * locale and time zone for formatting. `PictureUploadInterceptor` is
 * registered as a provider so Nest injects its configuration dependency.
 */
@Module({
  controllers: [UserController],
  providers: [UserService, PictureUploadInterceptor],
  exports: [UserService],
})
export class UserModule {}
