// helper/claimTx.mjs — settlement worker (security N4)

// A settlement pass claims its bets (status -> closed) and credits the wallet. Both run in one transaction,
// opened by `claim.open()` at the claim and committed by the pass right after the credit; any throw or
// return before that commit rolls the claim back, so a crash can never leave a bet closed but unpaid.
async function withClaimTx(db, fn) {
  const claim = { tx: null, open: async () => claim.tx = await db.transaction() };
  try {
    return await fn(claim);
  } finally {
    if (claim.tx && !claim.tx.finished) await claim.tx.rollback();
  }
}

export { withClaimTx };
