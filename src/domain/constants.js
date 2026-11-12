'use strict';

const CHANNELS = ['email', 'sms', 'whatsapp', 'telegram', 'webhook', 'in-app'];

const STATUS = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  RETRYING: 'retrying',
  SENT: 'sent',
  DELIVERED: 'delivered',
  FAILED: 'failed',
};
const FINAL_STATUSES = [STATUS.SENT, STATUS.DELIVERED, STATUS.FAILED];

/** Dashboard buckets: "delivered" covers sent + delivered, "pending" covers everything still in flight. */
const BUCKETS = {
  delivered: [STATUS.SENT, STATUS.DELIVERED],
  failed: [STATUS.FAILED],
  pending: [STATUS.QUEUED, STATUS.PROCESSING, STATUS.RETRYING],
};
const bucketOf = (status) => Object.keys(BUCKETS).find((b) => BUCKETS[b].includes(status)) || 'pending';

module.exports = { CHANNELS, STATUS, FINAL_STATUSES, BUCKETS, bucketOf };
