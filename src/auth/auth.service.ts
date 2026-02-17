import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { LoginDto } from 'src/common/dto/auth/login.dto';
import { RegisterDto } from 'src/common/dto/auth/register.dto';

@Injectable()
export class AuthService {
  static register(email: string, password: string) {
    throw new Error('Method not implemented.');
  }
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email;
    const password = dto.password;
    const existing = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existing) {
      throw new ConflictException('Email already exists');
    }
    const hashed = await bcrypt.hash(password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashed,
        telegramId: dto.telegramId,
        telegramUsername: dto.telegramUsername,
        firstName: dto.firstName,
        lastName: dto.lastName,
      },
    });

    console.log('reg user: ', user);

    const tokens = await this.generateToken(user.id, user.email);

    await this.updateRefreshToken(user.id, tokens.refreshToken);

    return tokens;
  }

  async validateUser(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.password);

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return user;
  }

  async login(dto: LoginDto) {
    const user = await this.validateUser(dto);

    const tokens = await this.generateToken(user.id, user.email);

    await this.updateRefreshToken(user.id, tokens.refreshToken);

    return tokens;
  }

  async refresh(refreshToken: string) {
    const payload = await this.jwtService.verifyAsync(refreshToken, {
      secret: this.configService.get('JWT_REFRESH_SECRET'),
    });

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user || !user.refreshTokenHash) {
      throw new UnauthorizedException();
    }

    const isMatch = await bcrypt.compare(refreshToken, user.refreshTokenHash);

    if (!isMatch) {
      throw new UnauthorizedException();
    }

    const tokens = await this.generateToken(user.id, user.email);

    await this.updateRefreshToken(user.id, tokens.refreshToken);

    return tokens;
  }

  async updateRefreshToken(userId: string, refreshToken: string) {
    const hashed = await bcrypt.hash(refreshToken, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: hashed },
    });
  }

  async generateToken(userId: string, email: string) {
    const payload = { sub: userId, email };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.get('JWT_SECRET'),
      expiresIn: '15m',
    });

    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.get('JWT_REFRESH_SECRET'),
      expiresIn: '7d',
    });

    return { accessToken, refreshToken };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        telegramUsername: true,
        role: true,
        firstName: true,
        lastName: true,
      },
    });

    console.log('user: ', user);
    return user;
  }

  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: null },
    });

    return { message: 'Logged out successfully' };
  }
}
