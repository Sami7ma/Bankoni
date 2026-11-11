import { buildImportPlan, type CbeReviewFields, type ImportContext, type IncomingSms } from './automatic/plan';
import { SOURCE_CATALOG } from './sources';

/** Manual file/paste authorization is explicit consent to the displayed exact sender/account.
 * Native queued evidence still uses the authoritative source registry supplied by its caller.
 */
export function buildReviewedCbePlan(message:IncomingSms,context:ImportContext,review:CbeReviewFields,now=Date.now()) {
    const sources=context.sources ?? [{...SOURCE_CATALOG[0],id:`review:${review.walletId}`,senderIds:[message.sender],walletId:review.walletId,selected:review.authorized,automatic:false}];
    return buildImportPlan({...message,walletId:message.walletId ?? review.walletId,providerId:message.providerId ?? 'cbe'}, {...context,sources},now,review);
}
