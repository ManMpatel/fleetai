import { Request, Response, NextFunction } from 'express'
import { auth } from 'express-oauth2-jwt-bearer'

export const requireAuth = auth({
  audience: `https://${process.env.AUTH0_DOMAIN}/api/v2/`,
  issuerBaseURL: `https://${process.env.AUTH0_DOMAIN}/`,
  tokenSigningAlg: 'RS256',
})

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  const payload = (req as any).auth?.payload
  const email = payload?.['https://fleetai.au.auth0.com/email'] || payload?.email
  if (email !== 'manpatel1144@gmail.com') {
    return res.status(403).json({ error: 'Admin access only' })
  }
  next()
}