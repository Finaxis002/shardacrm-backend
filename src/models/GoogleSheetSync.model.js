import mongoose from "mongoose";

const fieldMappingSchema = new mongoose.Schema({
  sheetColumn:      { type: String, required: true  },
  sheetColumnIndex: { type: Number, required: true  },
  crmField:         { type: String, required: true  },
  sampleData:       { type: String, default: ""     },
}, { _id: false });

const fixedValueSchema = new mongoose.Schema({
  crmField: { type: String, required: true },
  value:    { type: String, required: true },
}, { _id: false });

const googleSheetSyncSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    /* Google Sheet info */
    googleEmail:   { type: String, required: false, default: "" },
    sheetId:       { type: String, required: true },
    sheetName:     { type: String, required: true },
    tabName:       { type: String, required: true },
    sheetUrl:      { type: String, default: ""    },

    /* Mapping */
    fieldMappings: [fieldMappingSchema],
    fixedValues:   [fixedValueSchema],

    /* Sync state */
    isActive:      { type: Boolean, default: true  },
    lastRowSynced: { type: Number,  default: 1     },
    lastSyncedAt:  { type: Date,    default: null  },
    lastError:     { type: String,  default: null  },
    totalImported: { type: Number,  default: 0     },

    /* Access token */
    accessToken:    { type: String, default: null },
    tokenExpiresAt: { type: Date,   default: null },
  },
  { timestamps: true }
);

googleSheetSyncSchema.index({ organization: 1, isActive: 1 });
googleSheetSyncSchema.index({ sheetId: 1, tabName: 1 });

const GoogleSheetSync = mongoose.model("GoogleSheetSync", googleSheetSyncSchema);
export default GoogleSheetSync;