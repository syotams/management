import { Module } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { TeamsController, InvitesController } from './teams.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [TeamsController, InvitesController],
  providers: [TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
