import mongoose, { Document, Schema } from "mongoose";

export interface IAuditLog extends Document {
  actor: mongoose.Types.ObjectId;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  requestId?: string;
  timestamp: Date;
}

const auditLogSchema = new Schema<IAuditLog>({
  actor: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  actorRole: { type: String, required: true },
  action: { type: String, required: true, index: true },
  resourceType: { type: String, required: true },
  resourceId: { type: String },
  previousState: { type: Schema.Types.Mixed },
  newState: { type: Schema.Types.Mixed },
  requestId: { type: String },
  timestamp: { type: Date, default: Date.now, index: true },
});

export const AuditLog = mongoose.model<IAuditLog>("AuditLog", auditLogSchema);
