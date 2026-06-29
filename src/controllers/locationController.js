import AgentLocation from '../models/AgentLocation.js';

export const updateLocation = async (req, res) => {
  try {
    const { lat, lng } = req.body;
    await AgentLocation.findOneAndUpdate(
      { agent_id: req.user._id },
      { lat, lng, recorded_at: new Date() },
      { upsert: true, new: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getAllLatest = async (req, res) => {
  try {
    const latest = await AgentLocation.aggregate([
      { $sort: { recorded_at: -1 } },
      { $group: { _id: '$agent_id', doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
      { $lookup: { from: 'users', localField: 'agent_id',
          foreignField: '_id', as: 'agent' } },
      { $unwind: '$agent' },
      { $project: { lat:1, lng:1, recorded_at:1,
          'agent.name':1, 'agent.role':1, 'agent._id':1 } }
    ]);
    res.json(latest);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};