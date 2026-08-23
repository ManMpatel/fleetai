import { Request, Response, NextFunction } from 'express'
import { auth } from 'express-oauth2-jwt-bearer'
import { isSuperAdminRequest } from './tenant'

export const requireAuth = auth({
  audience: process.env.AUTH0_AUDIENCE || 'https://fleetai-production.up.railway.app',
  issuerBaseURL: `https://${process.env.AUTH0_DOMAIN}/`,
  tokenSigningAlg: 'RS256',
})

/**
 * Platform operator access. Keyed on the email claim inside the verified JWT — never on a
 * request header, which is how this check was previously bypassable.
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!isSuperAdminRequest(req)) {
    return res.status(403).json({ error: 'Admin access only' })
  }
  next()
}
