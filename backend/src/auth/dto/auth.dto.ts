import { IsEmail, IsString, MinLength, Matches, IsOptional } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(3)
  @Matches(/^[a-zA-Z0-9_-]+$/, { message: 'Name may only contain letters, numbers, underscores and hyphens' })
  name: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsOptional()
  @IsString()
  timezone?: string;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;

  @IsOptional()
  @IsString()
  timezone?: string;
}

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  timezone?: string;
}
