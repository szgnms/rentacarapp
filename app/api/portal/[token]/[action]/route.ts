import { publicHandler } from '@/lib/api';
import { HttpError } from '@/lib/core';
import { portalCheckin, portalNps, portalRequest } from '@/lib/domain/portal';

export const POST = publicHandler<{ token: string; action: string }>(({ params, body }) => {
  switch (params.action) {
    case 'checkin':
      return portalCheckin(params.token, body);
    case 'roadside':
    case 'extension_request':
      return portalRequest(params.token, params.action, body);
    case 'nps':
      return portalNps(params.token, body.score, body.comment);
    default:
      throw new HttpError(404, 'Bilinmeyen işlem');
  }
});
