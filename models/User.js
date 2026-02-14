import mongoose from "mongoose";
import slugify from "slugify";

const UserSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true
    },
    slug: {
        type: String,
        unique: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: function () {
            return !this.fromGoogle;
    }
    },
    img: {
        type: String,
    },
    imgBanner: {
        type: String,
    },
    follows: {
        type: Number,
        default: 0
    },
    followsProfile: {
        type: [String]
    },
    fromGoogle: {
        type: Boolean,
        default: false
    },
    descriptionAccount: {
        type: String,
    },
    totalViews: {
        type: Number
    },
    zip: { 
        type: Number,
        validate: {
            validator: function(v) {
                return /^[0-9]{5}$/.test(v.toString());
            },
            message: props => `${props.value} is not a valid zip code! It should be exactly 5 digits.`
        }
    }
},
{
    timestamps: true
}
)

UserSchema.pre("save", function (next) {
  if (this.isModified("name")) {
    this.slug = slugify(this.name, {
      lower: true,
      strict: true,
      trim: true,
    });
  }
  next();
});

export default mongoose.model('User', UserSchema)