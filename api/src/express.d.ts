declare namespace Express {
  interface Request {
    authUserId?: string;
    authSessionId?: string;
  }
}
