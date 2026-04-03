import mongoose from 'mongoose'

const employeeSchema = new mongoose.Schema({
  ownerId:   { type: String, required: true },
  name:      { type: String, required: true },
  pin:       { type: String, required: true }, // 4-digit
}, { timestamps: true })

export default mongoose.model('Employee', employeeSchema)