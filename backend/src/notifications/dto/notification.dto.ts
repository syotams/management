import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class NotificationIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];
}
