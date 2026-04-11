import mongoose from "mongoose";
import slugify from "slugify";

const USER_NAME_MAX = 50;
const USER_DESC_MAX = 500;

const UserSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        maxlength: [USER_NAME_MAX, `El nombre no puede exceder ${USER_NAME_MAX} caracteres`],
        trim: true,
        validate: {
            validator: function(v) {
                return v && v.trim().length > 0;
            },
            message: 'El nombre no puede estar vacío'
        }
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
        },
        minlength: [8, 'La contraseña debe tener al menos 8 caracteres'],
        validate: {
            validator: function(v) {
                if (!v || v.length < 8) return false;
                // Debe tener al menos: 1 mayúscula, 1 minúscula, 1 número
                return /[A-Z]/.test(v) && /[a-z]/.test(v) && /[0-9]/.test(v);
            },
            message: 'La contraseña debe tener al menos 8 caracteres, una mayúscula, una minúscula y un número'
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
        maxlength: [USER_DESC_MAX, `La descripción no puede exceder ${USER_DESC_MAX} caracteres`],
        default: ''
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
    },
    socialLinks: {
        twitter: { 
            type: String, 
            default: "",
            validate: {
                validator: function(v) {
                    if (!v || v === '') return true;
                    return /^@?[a-zA-Z0-9_]{1,15}$/.test(v);
                },
                message: 'Twitter inválido'
            }
        },
        instagram: { 
            type: String, 
            default: "",
            validate: {
                validator: function(v) {
                    if (!v || v === '') return true;
                    return /^[a-zA-Z0-9_.]{1,30}$/.test(v);
                },
                message: 'Instagram inválido'
            }
        },
        facebook: { 
            type: String, 
            default: "",
            validate: {
                validator: function(v) {
                    if (!v || v === '') return true;
                    return /^[a-zA-Z0-9.]+$/.test(v);
                },
                message: 'Facebook inválido'
            }
        },
        website: { 
            type: String, 
            default: "",
            validate: {
                validator: function(v) {
                    if (!v || v === '') return true;
                    try {
                        const url = new URL(v.startsWith('http') ? v : `https://${v}`);
                        return ['http:', 'https:'].includes(url.protocol);
                    } catch {
                        return false;
                    }
                },
                message: 'Website inválido'
            }
        }
    },
    passwordResetTokenHash: {
        type: String,
        select: false,
    },
    passwordResetExpires: {
        type: Date,
        select: false,
    },
    isDeleted: {
        type: Boolean,
        default: false,
        select: false,
    },
    deletedAt: {
        type: Date,
        default: null,
        select: false,
    },
    tokenVersion: {
        type: Number,
        default: 1,
        select: false,
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