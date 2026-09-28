import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateTaskListDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;
}

export class RenameTaskListDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;
}

export class DeleteTaskListQueryDto {
  @IsOptional()
  @IsString()
  moveTo?: string;
}
