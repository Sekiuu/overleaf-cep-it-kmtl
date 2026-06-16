import SessionManager from '../Authentication/SessionManager.mjs'
import { User } from '../../models/User.mjs'
import { expressify } from '@overleaf/promise-utils'

async function acceptTos(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)

  await User.updateOne(
    { _id: userId },
    { acceptedTermsOfServiceAt: new Date() }
  ).exec()

  res.sendStatus(204)
}

export default {
  acceptTos: expressify(acceptTos),
}
