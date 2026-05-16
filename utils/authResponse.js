/**
 * Cuerpo JSON de login: usuario sin campos sensibles + accessToken (Flutter / Bearer).
 */
export function userPayloadWithAccessToken(userDoc, accessToken) {
  const o =
    typeof userDoc?.toObject === 'function'
      ? userDoc.toObject()
      : { ...(userDoc?._doc ?? userDoc) };
  delete o.password;
  delete o.passwordResetTokenHash;
  delete o.passwordResetExpires;
  return {
    ...o,
    accessToken,
  };
}
