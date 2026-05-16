'use strict';

function isAuthorizedUser(message, authorizedUserIds) {
  const fromUserId = message && message.from && message.from.id;
  const ids = Array.isArray(authorizedUserIds) ? authorizedUserIds : [authorizedUserIds];

  if (ids.length === 0) {
    return false;
  }

  return ids.includes(fromUserId);
}

module.exports = {
  isAuthorizedUser
};
