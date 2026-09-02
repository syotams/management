import { Transform, Type } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsIn,
  IsDateString,
  IsBoolean,
  MinLength,
} from 'class-validator';

export class FindTasksQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  includeClosed?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsIn([7, 30])
  closedDays?: number;
}

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'urgent'])
  priority?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  teamId?: string;

  @IsOptional()
  @IsDateString()
  alertAt?: string;
}

export class PostponeTaskDto {
  @IsDateString()
  dueDate: string;

  @IsOptional()
  @IsDateString()
  alertAt?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    return value === true || value === 'true';
  })
  @IsBoolean()
  updateAlert?: boolean;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'urgent'])
  priority?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsDateString()
  alertAt?: string;
}

export class CreateCommentDto {
  @IsString()
  @MinLength(1)
  body: string;
}
