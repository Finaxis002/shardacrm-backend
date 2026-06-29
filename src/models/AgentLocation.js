import mongoose from 'mongoose';

const agentLocationSchema = new mongoose.Schema({
  agent_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  recorded_at: { type: Date, default: Date.now }
});

agentLocationSchema.index({ recorded_at: 1 }, { expireAfterSeconds: 604800 });

export default mongoose.model('AgentLocation', agentLocationSchema);  