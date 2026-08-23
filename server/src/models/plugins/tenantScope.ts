import { Schema } from 'mongoose'

// Guards against the class of bug that made multi-tenancy unsafe here: a query on a
// tenant-owned collection that forgets to filter by orgId. Every such query is a
// cross-tenant read or write.
//
// In development this throws so the mistake surfaces at the call site. In production it
// logs loudly rather than taking the app down. Genuinely global queries (migrations,
// cron sweeps that fan out per-org afterwards) opt out with:
//
//   Model.find({ ... }).setOptions({ allowCrossTenant: true })

const GUARDED_OPS =
  /^(find|findOne|findOneAndUpdate|findOneAndDelete|findOneAndReplace|countDocuments|updateOne|updateMany|deleteOne|deleteMany)$/

export function tenantScope(schema: Schema) {
  schema.pre(GUARDED_OPS, { query: true, document: false }, function (this: any, next: (err?: Error) => void) {
    if (this.getOptions?.().allowCrossTenant) return next()

    const filter = this.getFilter?.() ?? {}
    const hasOrgId =
      filter.orgId !== undefined ||
      (Array.isArray(filter.$and) && filter.$and.some((c: any) => c?.orgId !== undefined)) ||
      (Array.isArray(filter.$or)  && filter.$or.every((c: any) => c?.orgId !== undefined))

    if (hasOrgId) return next()

    const msg =
      `Unscoped query on ${this.model?.modelName ?? 'model'}.${this.op} — no orgId in the filter. ` +
      `Add orgId, or .setOptions({ allowCrossTenant: true }) if this is deliberately global.`

    if (process.env.NODE_ENV === 'production') {
      console.error(`⚠️  ${msg}`)
      return next()
    }
    return next(new Error(msg))
  })
}

/**
 * Populate spec for a join whose parent document was already tenant-scoped.
 *
 * Mongoose runs populate as a separate `{ _id: { $in: [...] } }` query on the referenced
 * model, which the guard above would otherwise reject. The ids come from a document that
 * was already fetched under an orgId filter, so the join inherits that scope — marking it
 * explicitly keeps the guard strict for genuine business-key lookups.
 */
export function scopedPopulate(path: string, select?: string) {
  return { path, select, options: { allowCrossTenant: true } }
}
