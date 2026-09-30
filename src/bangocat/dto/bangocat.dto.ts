import { Type } from 'class-transformer';
import { IsDefined, IsNumber, IsObject, IsOptional, IsString, Length, MaxLength, ValidateNested } from 'class-validator';

/** 成员携带的模型文件描述（仅元数据，文件内容走 P2P） */
export class ModelInfoDto {
  @IsOptional()
  @IsString({ message: 'model.name 必须是字符串' })
  name?: string;

  @IsOptional()
  @IsNumber({}, { message: 'model.size 必须是数字' })
  size?: number;

  @IsOptional()
  @IsString({ message: 'model.hash 必须是字符串' })
  hash?: string;

  @IsOptional()
  @IsObject({ message: 'model.meta 必须是对象' })
  meta?: Record<string, unknown>;
}

export class CreateRoomDto {
  /** 创建者昵称 */
  @IsOptional()
  @IsString({ message: 'name 必须是字符串' })
  @Length(1, 24, { message: 'name 长度需在 1-24 之间' })
  name?: string;

  /** 房间名，缺省时使用房间号 */
  @IsOptional()
  @IsString()
  @Length(1, 24, { message: 'roomName 长度需在 1-24 之间' })
  roomName?: string;

  /** 加入房间密码，缺省表示房间无密码 */
  @IsOptional()
  @IsString()
  @Length(1, 32, { message: 'password 长度需在 1-32 之间' })
  password?: string;

  /** 创建者的模型信息 */
  @IsOptional()
  @ValidateNested()
  @Type(() => ModelInfoDto)
  model?: ModelInfoDto;
}

export class JoinRoomDto {
  @IsOptional()
  @IsString({ message: 'name 必须是字符串' })
  @Length(1, 24, { message: 'name 长度需在 1-24 之间' })
  name?: string;

  @IsString()
  @Length(1, 64, { message: 'roomId 长度需在 1-64 之间' })
  roomId!: string;

  /** 房间有密码时必填 */
  @IsOptional()
  @IsString()
  @MaxLength(32, { message: 'password 最长 32 位' })
  password?: string;

  /** 加入者的模型信息 */
  @IsOptional()
  @ValidateNested()
  @Type(() => ModelInfoDto)
  model?: ModelInfoDto;
}

export class KickDto {
  @IsString({ message: 'memberId 必须是字符串' })
  @Length(1, 64, { message: 'memberId 长度需在 1-64 之间' })
  memberId!: string;
}

export class ModelUpdateDto {
  @IsDefined({ message: 'model 必填' })
  @ValidateNested()
  @Type(() => ModelInfoDto)
  model!: ModelInfoDto;
}

export class ChatDto {
  @IsString({ message: 'content 必须是字符串' })
  @Length(1, 500, { message: 'content 长度需在 1-500 之间' })
  content!: string;
}

export class SignalDto {
  @IsString({ message: 'to 必须是字符串' })
  @Length(1, 64, { message: 'to 长度需在 1-64 之间' })
  to!: string;

  @IsObject({ message: 'data 必须是对象（SDP / ICE 等信令内容）' })
  data!: Record<string, unknown>;
}
