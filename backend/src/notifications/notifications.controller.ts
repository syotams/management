import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { NotificationsService } from './notifications.service';
import { NotificationIdsDto } from './dto/notification.dto';
import { CurrentUser } from '../common/current-user.decorator';

@Controller('notifications')
@UseGuards(AuthGuard('jwt'))
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  findRecent(@CurrentUser() user: { id: string }) {
    return this.notifications.findRecent(user.id);
  }

  @Get('unread')
  unread(@CurrentUser() user: { id: string }) {
    return this.notifications.unread(user.id);
  }

  @Patch('read')
  markRead(@CurrentUser() user: { id: string }, @Body() dto: NotificationIdsDto) {
    return this.notifications.markRead(user.id, dto.ids);
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() user: { id: string }) {
    return this.notifications.markAllRead(user.id);
  }

  @Post('delete')
  remove(@CurrentUser() user: { id: string }, @Body() dto: NotificationIdsDto) {
    return this.notifications.remove(user.id, dto.ids);
  }
}
