import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TeamsService } from './teams.service';
import { CreateTeamDto, InviteMemberDto } from './dto/team.dto';
import { CurrentUser } from '../common/current-user.decorator';

@Controller('teams')
@UseGuards(AuthGuard('jwt'))
export class TeamsController {
  constructor(private teamsService: TeamsService) {}

  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateTeamDto) {
    return this.teamsService.create(user.id, dto);
  }

  @Get()
  findAll(@CurrentUser() user: { id: string }) {
    return this.teamsService.findAll(user.id);
  }

  @Get('assignable-members')
  assignableMembers(@CurrentUser() user: { id: string }) {
    return this.teamsService.getTeamMembersForAssignment(user.id);
  }

  @Get(':id/members')
  getMembers(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.teamsService.getMembers(id, user.id);
  }

  @Post(':id/invites')
  invite(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: InviteMemberDto,
  ) {
    return this.teamsService.invite(id, user.id, dto);
  }

  @Post(':id/invites/:inviteId/reinvite')
  reinvite(
    @Param('id') id: string,
    @Param('inviteId') inviteId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.teamsService.reinvite(id, inviteId, user.id);
  }

  @Delete(':id/invites/:inviteId')
  revokeInvite(
    @Param('id') id: string,
    @Param('inviteId') inviteId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.teamsService.revokeInvite(id, inviteId, user.id);
  }

  @Delete(':id/members/:userId')
  removeMember(
    @Param('id') id: string,
    @Param('userId') memberUserId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.teamsService.removeMember(id, memberUserId, user.id);
  }
}

@Controller('invites')
export class InvitesController {
  constructor(private teamsService: TeamsService) {}

  @Get('mine')
  @UseGuards(AuthGuard('jwt'))
  myInvites(@CurrentUser() user: { id: string }) {
    return this.teamsService.getMyPendingInvites(user.id);
  }

  @Get(':token')
  getInfo(@Param('token') token: string) {
    return this.teamsService.getInviteInfo(token);
  }

  @Post(':token/accept')
  @UseGuards(AuthGuard('jwt'))
  accept(@Param('token') token: string, @CurrentUser() user: { id: string }) {
    return this.teamsService.acceptInvite(token, user.id);
  }

  @Post(':token/deny')
  @UseGuards(AuthGuard('jwt'))
  deny(@Param('token') token: string, @CurrentUser() user: { id: string }) {
    return this.teamsService.denyInvite(token, user.id);
  }
}
