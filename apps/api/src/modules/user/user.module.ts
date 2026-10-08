import { Module } from '@nestjs/common';
import { PictureUploadInterceptor } from '../../common/http/picture-upload.interceptor.js';
import { UserController } from './user.controller.js';
import { UserService } from './user.service.js';

@Module({
  controllers: [UserController],
  providers: [UserService, PictureUploadInterceptor],
  exports: [UserService],
})
export class UserModule {}
