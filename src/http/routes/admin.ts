import { Router } from 'express';
import { withTx, getPool } from '../../infra/db.js';
import { readAfter } from '../../infra/eventStore.js';
import { tipSeq, waitForCheckpoint } from '../../projector/loop.js';
import { checkInvariants, trialBalance } from '../../read/queries.js';

export const adminRouter = Router();

adminRouter.post('/admin/rebuild-projections', async (_req, res, next) => {
  try {
    const target = await tipSeq();
    await withTx(async tx => {
      await tx.query(`DELETE FROM ledger_entries`);
      await tx.query(`DELETE FROM transaction_projection`);
      await tx.query(`DELETE FROM account_projection`);
      await tx.query(`UPDATE projector_checkpoint SET last_seq = 0 WHERE name = 'main'`);
    });
    const caught = await waitForCheckpoint(target, 10_000);
    res.json({ rebuilt: true, eventsReplayed: target, caughtUp: caught });
  } catch (err) { next(err); }
});

adminRouter.get('/admin/events', async (req, res, next) => {
  try {
    const stream = req.query.stream as string | undefined;
    const after = Number(req.query.after ?? 0);
    if (stream) {
      const { rows } = await getPool().query(
        `SELECT * FROM events WHERE stream_id = $1 ORDER BY version`,
        [stream],
      );
      res.json(rows);
    } else {
      res.json(await readAfter(after, 1000));
    }
  } catch (err) { next(err); }
});

adminRouter.get('/admin/ledger/invariants', async (_req, res, next) => {
  try {
    const r = await checkInvariants();
    const healthy =
      r.globalNet === 0 &&
      r.unbalancedGroups.length === 0 &&
      r.reconciliation.length === 0;
    res.status(healthy ? 200 : 500).json({ healthy, ...r });
  } catch (err) { next(err); }
});

adminRouter.get('/admin/ledger/trial-balance', async (_req, res, next) => {
  try {
    res.json(await trialBalance());
  } catch (err) { next(err); }
});
