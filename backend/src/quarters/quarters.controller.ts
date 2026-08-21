import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../common/current-user.decorator';
import { CreateEpicDto, CreateQuarterDto, UpdateQuarterDto } from './dto/quarter.dto';
import { QuartersService } from './quarters.service';

@Controller('quarters')
@UseGuards(AuthGuard('jwt'))
export class QuartersController {
  constructor(private quartersService: QuartersService) {}

  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateQuarterDto) {
    return this.quartersService.create(user.id, dto);
  }

  @Get()
  findAll(@CurrentUser() user: { id: string }) {
    return this.quartersService.findAll(user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.quartersService.findOne(id, user.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateQuarterDto,
  ) {
    return this.quartersService.update(id, user.id, dto);
  }

  @Patch(':id/complete')
  complete(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.quartersService.complete(id, user.id);
  }

  @Post(':id/epics')
  addEpic(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateEpicDto,
  ) {
    return this.quartersService.addEpic(id, user.id, dto);
  }
}
