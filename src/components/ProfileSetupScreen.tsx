import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  User,
  Image as ImageIcon,
  Camera,
  Calendar,
  MapPin,
  Music,
  Heart,
  Sparkles,
  Smile,
  Activity,
  Eye,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Briefcase,
  GraduationCap,
  Languages,
  HelpCircle,
  Compass,
  Globe,
  Trash2,
  Plus,
  Lock,
  UploadCloud,
  CheckCircle2,
  Smartphone,
  EyeOff,
  UserCheck,
  X,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { UserProfile } from "../types";
import CustomSelector from "./CustomSelector";
import ImageCropperModal from "./ImageCropperModal";
import CustomDatePicker from "./CustomDatePicker";
import { boyDefault, girlDefault, getDefaultAvatar, getUserAvatar, isDefaultOrPlaceholderAvatar } from "../utils/avatar";
import { formatUserFriendlyErrorMessage } from "../utils/errorMessage";
import { Capacitor } from "@capacitor/core";
import { Camera as CameraPlugin, CameraResultType, CameraSource } from "@capacitor/camera";

interface ProfileSetupScreenProps {
  isEditing?: boolean;
  onCancel?: () => void;
  onComplete?: () => void;
}

const PRESET_AVATARS = [
  girlDefault,
  boyDefault,
];

const PRESET_COVERS = [
  "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1542831371-29b0f74f9713?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1516259762381-22954d7d3ad2?auto=format&fit=crop&w=800&q=80",
];

const MUSIC_CATEGORIES = [
  "Pop",
  "Hip Hop",
  "Rock",
  "Lo-fi",
  "Jazz",
  "EDM",
  "Classical",
  "Punjabi",
  "Bollywood",
  "K-Pop",
  "Indie",
];

const INTERESTS_CHIPS = [
  "Travel",
  "Photography",
  "Movies",
  "Gaming",
  "Fitness",
  "Cooking",
  "Reading",
  "Art",
  "Fashion",
  "Technology",
  "Cars",
  "Pets",
  "Music",
  "Dancing",
  "Hiking",
  "Business",
  "Entrepreneurship",
  "Sports",
  "Anime",
  "Nature",
  "Coffee",
  "Food",
  "Adventure",
  "Gym",
  "Coding",
  "Writing",
  "Meditation",
  "Lifestyle",
];

export default function ProfileSetupScreen({
  isEditing = false,
  onCancel,
  onComplete,
}: ProfileSetupScreenProps) {
  const { userProfile, updateProfile } = useAuth();

  // Helper wrapper to attempt profile saving with a 3-second retry mechanism
  const updateProfileWithRetry = async (data: Partial<UserProfile>): Promise<string | void> => {
    try {
      return await updateProfile(data);
    } catch (err) {
      console.warn("[ProfileSetup] First profile save attempt failed. Retrying in 3 seconds...", err);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return await updateProfile(data);
    }
  };

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [successToast, setSuccessToast] = useState("");
  const [error, setError] = useState("");

  // Step Form States
  const [gender, setGender] = useState(userProfile?.gender || "Non-binary");
  const [avatarUrl, setAvatarUrl] = useState(
    getUserAvatar(userProfile, userProfile?.gender || "Non-binary")
  );

  useEffect(() => {
    if (isDefaultOrPlaceholderAvatar(avatarUrl)) {
      setAvatarUrl(getDefaultAvatar(gender));
    }
  }, [gender]);
  const [coverPhotoUrl, setCoverPhotoUrl] = useState(
    userProfile?.coverPhotoUrl || PRESET_COVERS[0]
  );
  const [portfolioPhotos, setPortfolioPhotos] = useState<string[]>(
    userProfile?.portfolioPhotos || []
  );

  const [fullName, setFullName] = useState(
    userProfile?.fullName || userProfile?.displayName || ""
  );
  const [username, setUsername] = useState(userProfile?.username || "");
  const [dateOfBirth, setDateOfBirth] = useState(userProfile?.dateOfBirth || "");
  const [age, setAge] = useState<number>(userProfile?.age || 21);
  const [interestedIn, setInterestedIn] = useState(userProfile?.interestedIn || "Everyone");
  const [relationshipGoal, setRelationshipGoal] = useState(
    userProfile?.relationshipGoal || "Friendship"
  );

  const [country, setCountry] = useState(userProfile?.country || "United States");
  const [state, setState] = useState(userProfile?.state || "New York");
  const [city, setCity] = useState(userProfile?.city || "New York");
  const [currentLocation, setCurrentLocation] = useState(userProfile?.currentLocation || "");
  const [distancePreference, setDistancePreference] = useState<number>(
    userProfile?.distancePreference || 25
  );

  const [bio, setBio] = useState(userProfile?.bio || "");
  const [occupation, setOccupation] = useState(
    userProfile?.occupation || userProfile?.specialty || ""
  );
  const [education, setEducation] = useState(userProfile?.education || "");
  const [languagesSpoken, setLanguagesSpoken] = useState<string[]>(
    userProfile?.languagesSpoken || ["English"]
  );
  const [newLanguage, setNewLanguage] = useState("");

  const [selectedMusic, setSelectedMusic] = useState<string[]>(
    userProfile?.musicCategories || []
  );
  const [selectedInterests, setSelectedInterests] = useState<string[]>(
    userProfile?.interests || []
  );

  const [smoking, setSmoking] = useState(userProfile?.smoking || "Non-smoker");
  const [drinking, setDrinking] = useState(userProfile?.drinking || "Social drinker");
  const [workoutFrequency, setWorkoutFrequency] = useState(
    userProfile?.workoutFrequency || "Weekly"
  );
  const [religion, setReligion] = useState(userProfile?.religion || "");
  const [height, setHeight] = useState(userProfile?.height || "5'9\"");
  const [personalityType, setPersonalityType] = useState(userProfile?.personalityType || "");

  const [minAgePreference, setMinAgePreference] = useState<number>(
    userProfile?.minAgePreference || 18
  );
  const [maxAgePreference, setMaxAgePreference] = useState<number>(
    userProfile?.maxAgePreference || 45
  );
  const [maxDistancePreference, setMaxDistancePreference] = useState<number>(
    userProfile?.maxDistancePreference || 50
  );
  const [lookingFor, setLookingFor] = useState(userProfile?.lookingFor || "Friendship");
  const [showMe, setShowMe] = useState(userProfile?.showMe || "Everyone");
  const [visibilitySettings, setVisibilitySettings] = useState(
    userProfile?.visibilitySettings || "Public"
  );

  // Username validation state
  // Live checking states have been removed in favor of auto-appending unique random suffixes

  // Cropper States
  const [cropperOpen, setCropperOpen] = useState(false);
  const [cropperImage, setCropperImage] = useState("");
  const [cropperType, setCropperType] = useState<"circle" | "square" | "cover">("circle");
  const [activePhotoSlot, setActivePhotoSlot] = useState<number | null>(null); // null for avatar, -1 for cover, 0-4 for portfolio

  // Upload progress simulation state
  const [uploadProgress, setUploadProgress] = useState<{ [key: string]: number }>({});

  // Field validation issues highlighted states
  const [validationErrors, setValidationErrors] = useState<{ [key: string]: boolean }>({});

  // Section edit toggles for independent editing in Edit Profile Mode
  const [editingSections, setEditingSections] = useState<{ [key: string]: boolean }>({});

  // HTML File Input Ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Compute age from Date of Birth
  useEffect(() => {
    if (dateOfBirth) {
      const birthDate = new Date(dateOfBirth);
      const today = new Date();
      let calculatedAge = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        calculatedAge--;
      }
      if (calculatedAge > 0) {
        setAge(calculatedAge);
      }
    }
  }, [dateOfBirth]);

  // Load draft from localStorage on mount
  useEffect(() => {
    if (isEditing) return;
    try {
      const savedDraft = localStorage.getItem("aura_profile_setup_draft");
      if (savedDraft) {
        const draft = JSON.parse(savedDraft);
        if (draft.step) setStep(draft.step);
        if (draft.avatarUrl) setAvatarUrl(draft.avatarUrl);
        if (draft.coverPhotoUrl) setCoverPhotoUrl(draft.coverPhotoUrl);
        if (draft.portfolioPhotos) setPortfolioPhotos(draft.portfolioPhotos);
        if (draft.fullName) setFullName(draft.fullName);
        if (draft.username) setUsername(draft.username);
        if (draft.dateOfBirth) setDateOfBirth(draft.dateOfBirth);
        if (draft.gender) setGender(draft.gender);
        if (draft.interestedIn) setInterestedIn(draft.interestedIn);
        if (draft.relationshipGoal) setRelationshipGoal(draft.relationshipGoal);
        if (draft.country) setCountry(draft.country);
        if (draft.state) setState(draft.state);
        if (draft.city) setCity(draft.city);
        if (draft.currentLocation) setCurrentLocation(draft.currentLocation);
        if (draft.distancePreference) setDistancePreference(draft.distancePreference);
        if (draft.bio) setBio(draft.bio);
        if (draft.occupation) setOccupation(draft.occupation);
        if (draft.education) setEducation(draft.education);
        if (draft.languagesSpoken) setLanguagesSpoken(draft.languagesSpoken);
        if (draft.selectedMusic) setSelectedMusic(draft.selectedMusic);
        if (draft.selectedInterests) setSelectedInterests(draft.selectedInterests);
        if (draft.smoking) setSmoking(draft.smoking);
        if (draft.drinking) setDrinking(draft.drinking);
        if (draft.workoutFrequency) setWorkoutFrequency(draft.workoutFrequency);
        if (draft.religion) setReligion(draft.religion);
        if (draft.height) setHeight(draft.height);
        if (draft.personalityType) setPersonalityType(draft.personalityType);
        if (draft.minAgePreference) setMinAgePreference(draft.minAgePreference);
        if (draft.maxAgePreference) setMaxAgePreference(draft.maxAgePreference);
        if (draft.maxDistancePreference) setMaxDistancePreference(draft.maxDistancePreference);
        if (draft.lookingFor) setLookingFor(draft.lookingFor);
        if (draft.showMe) setShowMe(draft.showMe);
        if (draft.visibilitySettings) setVisibilitySettings(draft.visibilitySettings);
      }
    } catch (e) {
      console.error("Error loading profile setup draft from localStorage", e);
    }
  }, [isEditing]);

  // Save draft to localStorage on change
  useEffect(() => {
    if (isEditing) return;
    try {
      const draft = {
        step,
        avatarUrl,
        coverPhotoUrl,
        portfolioPhotos,
        fullName,
        username,
        dateOfBirth,
        gender,
        interestedIn,
        relationshipGoal,
        country,
        state,
        city,
        currentLocation,
        distancePreference,
        bio,
        occupation,
        education,
        languagesSpoken,
        selectedMusic,
        selectedInterests,
        smoking,
        drinking,
        workoutFrequency,
        religion,
        height,
        personalityType,
        minAgePreference,
        maxAgePreference,
        maxDistancePreference,
        lookingFor,
        showMe,
        visibilitySettings,
      };
      localStorage.setItem("aura_profile_setup_draft", JSON.stringify(draft));
    } catch (e) {
      console.error("Error saving profile setup draft to localStorage", e);
    }
  }, [
    isEditing,
    step,
    avatarUrl,
    coverPhotoUrl,
    portfolioPhotos,
    fullName,
    username,
    dateOfBirth,
    gender,
    interestedIn,
    relationshipGoal,
    country,
    state,
    city,
    currentLocation,
    distancePreference,
    bio,
    occupation,
    education,
    languagesSpoken,
    selectedMusic,
    selectedInterests,
    smoking,
    drinking,
    workoutFrequency,
    religion,
    height,
    personalityType,
    minAgePreference,
    maxAgePreference,
    maxDistancePreference,
    lookingFor,
    showMe,
    visibilitySettings,
  ]);

  // Format username to allow lowercase, numbers, and underscores only
  useEffect(() => {
    const formattedUsername = username.toLowerCase().trim().replace(/[^a-z0-9_]/g, "");
    if (username !== formattedUsername) {
      setUsername(formattedUsername);
    }
  }, [username]);

  // Handle Photo Picker trigger
  const triggerPhotoUpload = async (slot: number | null, type: "circle" | "square" | "cover") => {
    setActivePhotoSlot(slot);
    setCropperType(type);

    if (Capacitor.isNativePlatform()) {
      try {
        const image = await CameraPlugin.getPhoto({
          quality: 90,
          allowEditing: true,
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Prompt // This gives user option for Camera or Gallery
        });

        if (image.dataUrl) {
          handleCroppedSave(image.dataUrl);
        }
      } catch (err) {
        console.warn("User cancelled or camera error:", err);
      }
      return;
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  // Handle local File Selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setCropperImage(reader.result);
        setCropperOpen(true);
      }
    };
    reader.readAsDataURL(file);
  };

  // Save the cropped image with a beautiful progress upload bar
  const handleCroppedSave = (croppedData: string) => {
    setCropperOpen(false);

    // Identify which slot to progress
    const progressKey =
      activePhotoSlot === null
        ? "avatar"
        : activePhotoSlot === -1
        ? "cover"
        : `portfolio-${activePhotoSlot}`;

    // Simulate progress
    setUploadProgress((prev) => ({ ...prev, [progressKey]: 10 }));

    let currentProgress = 10;
    const interval = setInterval(() => {
      currentProgress += Math.floor(Math.random() * 25) + 15;
      if (currentProgress >= 100) {
        currentProgress = 100;
        clearInterval(interval);

        // Update target state
        if (activePhotoSlot === null) {
          setAvatarUrl(croppedData);
        } else if (activePhotoSlot === -1) {
          setCoverPhotoUrl(croppedData);
        } else {
          setPortfolioPhotos((prev) => {
            const updated = [...prev];
            updated[activePhotoSlot] = croppedData;
            return updated;
          });
        }

        setTimeout(() => {
          setUploadProgress((prev) => {
            const copy = { ...prev };
            delete copy[progressKey];
            return copy;
          });
        }, 300);
      } else {
        setUploadProgress((prev) => ({ ...prev, [progressKey]: currentProgress }));
      }
    }, 150);
  };

  // Drag and drop photo reorder
  const [draggedPhotoIdx, setDraggedPhotoIdx] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    setDraggedPhotoIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (draggedPhotoIdx === null || draggedPhotoIdx === targetIdx) return;

    const updated = [...portfolioPhotos];
    const temp = updated[draggedPhotoIdx];
    updated[draggedPhotoIdx] = updated[targetIdx];
    updated[targetIdx] = temp;

    setPortfolioPhotos(updated);
    setDraggedPhotoIdx(null);
  };

  // Delete portfolio photo
  const deletePortfolioPhoto = (idx: number) => {
    setPortfolioPhotos((prev) => prev.filter((_, i) => i !== idx));
  };

  // Required validation checks
  const runValidation = (): boolean => {
    const errors: { [key: string]: boolean } = {};

    if (!fullName.trim()) errors.fullName = true;
    if (!username.trim() || username.length < 3) errors.username = true;
    if (!dateOfBirth) errors.dateOfBirth = true;
    if (age < 18) errors.ageUnder = true;
    if (!gender) errors.gender = true;
    if (!interestedIn) errors.interestedIn = true;
    if (!avatarUrl) errors.avatarUrl = true;

    setValidationErrors(errors);

    const hasErrors = Object.keys(errors).length > 0;
    if (hasErrors) {
      if (errors.fullName) setError("Full Name is required.");
      else if (errors.username) setError("Valid username is required (at least 3 characters).");
      else if (errors.dateOfBirth) setError("Date of birth is required.");
      else if (errors.ageUnder) setError("You must be 18 years or older.");
      else if (errors.gender) setError("Gender selection is required.");
      else setError("Please complete all required fields highlighted in red.");
      return false;
    }

    setError("");
    return true;
  };

  // Proceed next wizard page in Onboarding mode
  const handleNext = () => {
    setError("");
    setValidationErrors({});

    if (step === 1) {
      if (!fullName.trim()) {
        setValidationErrors({ fullName: true });
        setError("Full Name is required.");
        return;
      }
      if (!username.trim() || username.length < 3) {
        setValidationErrors({ username: true });
        setError("Username is required (at least 3 characters).");
        return;
      }
      if (!dateOfBirth) {
        setValidationErrors({ dateOfBirth: true });
        setError("Date of Birth is required.");
        return;
      }
    }
    if (step === 3) {
      if (!city.trim() || !state.trim() || !country.trim()) {
        setError("Please enter City, State, and Country.");
        return;
      }
    }

    if (step < 9) {
      setStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    setError("");
    if (step > 1) {
      setStep((prev) => prev - 1);
    }
  };

  const handleLanguageAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (newLanguage.trim() && !languagesSpoken.includes(newLanguage.trim())) {
      setLanguagesSpoken((prev) => [...prev, newLanguage.trim()]);
      setNewLanguage("");
    }
  };

  const handleLanguageRemove = (lang: string) => {
    setLanguagesSpoken((prev) => prev.filter((l) => l !== lang));
  };

  const toggleMusic = (cat: string) => {
    setSelectedMusic((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const toggleInterest = (interest: string) => {
    setSelectedInterests((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest]
    );
  };

  // Independent single section save helper (for Edit Profile cards)
  const handleSaveSection = async (sectionName: string) => {
    setLoading(true);
    setError("");

    // Section specific validation
    if (sectionName === "personal") {
      if (!fullName.trim() || !username.trim() || username.length < 3) {
        setError("Full Name and a valid Username are required.");
        setLoading(false);
        return;
      }
    }

    try {
      const fieldData: Partial<UserProfile> = {};

      if (sectionName === "photos") {
        fieldData.avatarUrl = avatarUrl;
        fieldData.coverPhotoUrl = coverPhotoUrl;
        fieldData.portfolioPhotos = portfolioPhotos;
      } else if (sectionName === "personal") {
        fieldData.fullName = fullName;
        fieldData.displayName = fullName;
        fieldData.username = username;
        fieldData.dateOfBirth = dateOfBirth;
        fieldData.age = age;
        fieldData.gender = gender;
      } else if (sectionName === "about") {
        fieldData.bio = bio;
        fieldData.specialty = occupation || "Digital Creator";
      } else if (sectionName === "location") {
        fieldData.country = country;
        fieldData.state = state;
        fieldData.city = city;
        fieldData.currentLocation = currentLocation || `${city}, ${state}`;
      } else if (sectionName === "occupation") {
        fieldData.occupation = occupation;
        fieldData.specialty = occupation || "Digital Creator";
      } else if (sectionName === "education") {
        fieldData.education = education;
      } else if (sectionName === "languages") {
        fieldData.languagesSpoken = languagesSpoken;
      } else if (sectionName === "interests") {
        fieldData.interests = selectedInterests;
        fieldData.skillTags = selectedInterests.slice(0, 4);
      } else if (sectionName === "music") {
        fieldData.musicCategories = selectedMusic;
      } else if (sectionName === "lifestyle") {
        fieldData.smoking = smoking;
        fieldData.drinking = drinking;
        fieldData.workoutFrequency = workoutFrequency;
        fieldData.religion = religion;
        fieldData.height = height;
        fieldData.personalityType = personalityType;
      } else if (sectionName === "dating") {
        fieldData.interestedIn = interestedIn;
        fieldData.relationshipGoal = relationshipGoal;
        fieldData.minAgePreference = minAgePreference;
        fieldData.maxAgePreference = maxAgePreference;
        fieldData.maxDistancePreference = maxDistancePreference;
        fieldData.lookingFor = lookingFor;
        fieldData.showMe = showMe;
      } else if (sectionName === "privacy") {
        fieldData.visibilitySettings = visibilitySettings;
      }

      const finalUsername = await updateProfileWithRetry(fieldData);

      if (sectionName === "personal" && finalUsername && finalUsername !== username) {
        setUsername(finalUsername);
        setSuccessToast(`✅ Saved! Your assigned username is @${finalUsername}`);
        setTimeout(() => setSuccessToast(""), 4000);
      } else {
        // Trigger beautiful visual temporary toast
        setSuccessToast(`✅ Section Updated Successfully`);
        setTimeout(() => setSuccessToast(""), 3000);
      }

      // Close editing state
      setEditingSections((prev) => ({ ...prev, [sectionName]: false }));
    } catch (err: any) {
      console.error(err);
      setError(formatUserFriendlyErrorMessage(err, "Failed to save section updates. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  // Support skipping/setup later flow for easier onboarding
  const handleSetupLater = async () => {
    setLoading(true);
    setError("");

    try {
      const emailDerived = userProfile?.email?.split('@')[0];
      const fallbackFromEmail = emailDerived ? emailDerived.charAt(0).toUpperCase() + emailDerived.slice(1) : "Member";
      const defaultName = fullName.trim() || userProfile?.displayName || userProfile?.fullName || fallbackFromEmail;
      const defaultUsername = (username.trim().length >= 3) 
        ? username.trim() 
        : (userProfile?.username || `creator_${Math.floor(1000 + Math.random() * 9000)}`);

      const updatedFields: Partial<UserProfile> = {
        displayName: defaultName,
        fullName: defaultName,
        username: defaultUsername,
        dateOfBirth: dateOfBirth || "2000-01-01",
        age: age || 24,
        gender: gender || "Non-binary",
        avatarUrl: avatarUrl || PRESET_AVATARS[0],
        coverPhotoUrl: coverPhotoUrl || PRESET_COVERS[0],
        portfolioPhotos: portfolioPhotos.length > 0 ? portfolioPhotos : [avatarUrl || PRESET_AVATARS[0]],
        profileCompleted: true,
        hasCompletedProfileSetup: true,
        skippedProfileSetup: true,
      };

      if (userProfile?.uid) {
        try {
          localStorage.setItem(`aura_onboarding_completed_${userProfile.uid}`, "true");
          localStorage.setItem(`aura_skipped_onboarding_${userProfile.uid}`, "true");
        } catch (e) {}
      }

      await updateProfileWithRetry(updatedFields);

      try {
        localStorage.removeItem("aura_profile_setup_draft");
      } catch (err) {
        console.error("Failed to clear draft:", err);
      }

      setSuccessToast("⏩ Skipped profile setup! You can update your profile anytime.");
      setTimeout(() => {
        setSuccessToast("");
        if (onComplete) onComplete();
      }, 1000);
    } catch (err: any) {
      console.error("Failed to save skipped profile:", err);
      setError(formatUserFriendlyErrorMessage(err, "Failed to skip setup. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  // Global Complete / Onboarding Finish save flow
  const handleSaveAllProfile = async () => {
    if (!runValidation()) return;

    setLoading(true);
    setError("");

    try {
      const updatedFields: Partial<UserProfile> = {
        displayName: fullName,
        fullName,
        username,
        avatarUrl,
        coverPhotoUrl,
        dateOfBirth,
        age,
        gender,
        interestedIn,
        relationshipGoal,
        country,
        state,
        city,
        currentLocation: currentLocation || `${city}, ${state}`,
        distancePreference,
        bio,
        specialty: occupation || "Digital Creator",
        occupation,
        education,
        languagesSpoken,
        musicCategories: selectedMusic,
        interests: selectedInterests,
        smoking,
        drinking,
        workoutFrequency,
        religion,
        height,
        personalityType,
        minAgePreference,
        maxAgePreference,
        maxDistancePreference,
        lookingFor,
        showMe,
        visibilitySettings,
        portfolioPhotos: portfolioPhotos.length > 0 ? portfolioPhotos : [avatarUrl],
        skillTags: selectedInterests.slice(0, 4),
        profileCompleted: true,
        hasCompletedProfileSetup: true,
      };

      if (userProfile?.uid) {
        try {
          localStorage.setItem(`aura_onboarding_completed_${userProfile.uid}`, "true");
        } catch (e) {}
      }

      const finalUsername = await updateProfileWithRetry(updatedFields);

      // Clear the localStorage draft since setup has been successfully completed
      try {
        localStorage.removeItem("aura_profile_setup_draft");
      } catch (err) {
        console.error("Failed to clear profile setup draft:", err);
      }

      const hasNewUsername = finalUsername && finalUsername !== username;
      if (hasNewUsername) {
        setUsername(finalUsername);
        setSuccessToast(`✅ Saved! Your assigned username is @${finalUsername}`);
      } else {
        setSuccessToast("✅ Profile Updated Successfully");
      }

      setTimeout(() => {
        setSuccessToast("");
        if (onComplete) onComplete();
      }, hasNewUsername ? 3500 : 1500);
    } catch (err: any) {
      console.error(err);
      setError(formatUserFriendlyErrorMessage(err, "Failed to update profile data. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  // Section card read view helper
  const renderReadCardHeader = (title: string, icon: any, editKey: string) => {
    return (
      <div className="flex justify-between items-center pb-3 border-b border-[#2A2A2A] mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-[#E5FF3B]/10 text-[#E5FF3B] flex items-center justify-center">
            {React.createElement(icon, { className: "w-4 h-4" })}
          </div>
          <span className="text-sm font-extrabold text-white tracking-tight">{title}</span>
        </div>
        <button
          type="button"
          onClick={() => setEditingSections((prev) => ({ ...prev, [editKey]: !prev[editKey] }))}
          className="px-4 py-1.5 bg-[#1E1E1E] border border-[#2A2A2A] text-[#A1A1AA] hover:text-white text-[10px] font-black uppercase tracking-wider rounded-full hover:bg-[#2A2A2A] transition cursor-pointer"
        >
          {editingSections[editKey] ? "Cancel" : "Edit"}
        </button>
      </div>
    );
  };

  // Section card edit footer action buttons
  const renderEditCardFooter = (editKey: string) => {
    return (
      <div className="flex gap-2.5 justify-end mt-5 pt-4 border-t border-[#2A2A2A]">
        <button
          type="button"
          onClick={() => setEditingSections((prev) => ({ ...prev, [editKey]: false }))}
          className="px-4 h-9 border border-[#2A2A2A] hover:bg-[#2A2A2A] text-[#A1A1AA] hover:text-white rounded-full text-[10px] font-black uppercase tracking-wider cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => handleSaveSection(editKey)}
          disabled={loading}
          className="px-5 h-9 bg-[#E5FF3B] hover:bg-[#d8f030] text-black font-extrabold rounded-full text-[10px] uppercase tracking-wider flex items-center gap-1 cursor-pointer disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-black" />
          ) : (
            <Check className="w-3.5 h-3.5" />
          )}
          <span>Save Card</span>
        </button>
      </div>
    );
  };

  // RENDER CONTENT FOR STEP-BY-STEP ONBOARDING
  const renderStepContentOnboarding = () => {
    switch (step) {
      case 1:
        return (
          <div className="space-y-5">
            <div className="text-center">
              <h4 className="text-lg font-black tracking-tight text-white">Basic Identity</h4>
              <p className="text-xs text-[#A1A1AA] font-medium mt-1">Setup your personal branding name tags</p>
            </div>

            <div className="space-y-4 text-left">
              <div className="space-y-1.5">
                <label className="text-[11px] font-black uppercase tracking-widest text-[#A1A1AA]">Full Name</label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    placeholder="Enter full display name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className={`w-full h-11 bg-[#141414] border rounded-xl px-4 text-xs font-semibold focus:border-[#E5FF3B] text-white outline-none placeholder-zinc-600 ${
                      validationErrors.fullName ? "border-rose-500 bg-rose-950/20" : "border-[#2A2A2A]"
                    }`}
                  />
                  <User className="absolute right-3.5 top-3.5 w-4 h-4 text-[#A1A1AA]" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-black uppercase tracking-widest text-[#A1A1AA]">Username</label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    placeholder="unique_handle"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className={`w-full h-11 bg-[#141414] border rounded-xl px-4 text-xs font-semibold focus:border-[#E5FF3B] text-white outline-none placeholder-zinc-600 ${
                      validationErrors.username ? "border-rose-500 bg-rose-950/20" : "border-[#2A2A2A]"
                    }`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black uppercase tracking-widest text-[#A1A1AA]">Date of Birth</label>
                  <CustomDatePicker
                    value={dateOfBirth}
                    onChange={(val) => setDateOfBirth(val)}
                    error={!!validationErrors.dateOfBirth}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black uppercase tracking-widest text-[#A1A1AA]">Gender</label>
                  <CustomSelector
                    label="Gender"
                    value={gender}
                    onChange={setGender}
                    options={["Non-binary", "Female", "Male", "Genderfluid", "Agender", "Other / Decline"]}
                  />
                </div>
              </div>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <div className="text-center">
              <h4 className="text-lg font-black tracking-tight text-white">Aesthetic Gallery Presence</h4>
              <p className="text-xs text-[#A1A1AA] font-medium mt-1">Upload crop portraits, backdrop covers, and creator photos</p>
            </div>

            <div className="space-y-6">
              {/* Cover Banner */}
              <div className="space-y-2 text-left relative">
                <span className="text-[11px] font-black uppercase tracking-widest text-[#A1A1AA]">Cover Photo / Banner</span>
                <div className="h-32 rounded-2xl bg-[#141414] relative overflow-hidden border border-[#2A2A2A]">
                  <img src={coverPhotoUrl} alt="Cover Preview" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <button
                      type="button"
                      onClick={() => triggerPhotoUpload(-1, "cover")}
                      className="px-4 py-2.5 bg-[#1E1E1E] text-white border border-[#2A2A2A] rounded-full text-[10px] font-extrabold uppercase tracking-wider shadow hover:bg-[#2A2A2A] transition flex items-center gap-1"
                    >
                      <Camera className="w-3.5 h-3.5 text-[#E5FF3B]" /> Adjust Cover
                    </button>
                  </div>
                  {uploadProgress["cover"] !== undefined && (
                    <div className="absolute bottom-0 inset-x-0 h-1 bg-[#2A2A2A]">
                      <div className="h-full bg-[#E5FF3B] transition-all" style={{ width: `${uploadProgress["cover"]}%` }} />
                    </div>
                  )}
                </div>

                <div className="flex gap-2 overflow-x-auto py-1 custom-scrollbar">
                  {PRESET_COVERS.map((cov, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setCoverPhotoUrl(cov)}
                      className={`h-10 w-16 rounded-lg overflow-hidden shrink-0 border-2 transition ${
                        coverPhotoUrl === cov ? "border-[#E5FF3B]" : "border-transparent opacity-60"
                      }`}
                    >
                      <img src={cov} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Portrait Avatar */}
              <div className="space-y-2 text-left">
                <span className="text-[11px] font-black uppercase tracking-widest text-[#A1A1AA] block">Profile portrait</span>
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-full bg-[#141414] relative overflow-hidden border border-[#2A2A2A] shrink-0">
                    <img src={avatarUrl} alt="Portrait Preview" className="w-full h-full object-cover" />
                    {uploadProgress["avatar"] !== undefined && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <Loader2 className="w-5 h-5 text-[#E5FF3B] animate-spin" />
                      </div>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => triggerPhotoUpload(null, "circle")}
                      className="px-4 h-9 bg-[#E5FF3B] text-black font-extrabold rounded-full text-[10px] uppercase tracking-wider hover:bg-[#d8f030] flex items-center gap-1 active:scale-95 transition"
                    >
                      <UploadCloud className="w-3.5 h-3.5" /> Upload Custom
                    </button>
                    <p className="text-[10px] text-[#A1A1AA] font-semibold">Or tap any preset portrait option below</p>
                  </div>
                </div>

                <div className="flex gap-2 overflow-x-auto py-1.5 custom-scrollbar">
                  {PRESET_AVATARS.map((av, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setAvatarUrl(av)}
                      className={`h-11 w-11 rounded-full overflow-hidden shrink-0 border-2 transition ${
                        avatarUrl === av ? "border-[#E5FF3B]" : "border-transparent opacity-60"
                      }`}
                    >
                      <img src={av} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>

              {/* 5 Portfolio Photos upload with reorder */}
              <div className="space-y-2.5 text-left">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-black uppercase tracking-widest text-[#A1A1AA]">Additional profile photos (Drag to reorder)</span>
                  <span className="text-[10px] text-[#E5FF3B] font-bold">{portfolioPhotos.length}/5 photos</span>
                </div>

                <div className="grid grid-cols-5 gap-2.5">
                  {[0, 1, 2, 3, 4].map((idx) => {
                    const hasPhoto = portfolioPhotos[idx];
                    const isUploading = uploadProgress[`portfolio-${idx}`] !== undefined;

                    return (
                      <div
                        key={idx}
                        draggable={!!hasPhoto}
                        onDragStart={(e) => handleDragStart(e, idx)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, idx)}
                        className={`aspect-square rounded-xl bg-[#141414] border-2 border-dashed border-[#2A2A2A] relative overflow-hidden flex flex-col items-center justify-center transition cursor-grab active:cursor-grabbing hover:border-zinc-600 ${
                          draggedPhotoIdx === idx ? "opacity-40" : ""
                        }`}
                      >
                        {hasPhoto ? (
                          <>
                            <img src={hasPhoto} alt="" className="w-full h-full object-cover pointer-events-none" />
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                deletePortfolioPhoto(idx);
                              }}
                              className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 hover:bg-rose-600 flex items-center justify-center text-white transition shadow"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </>
                        ) : isUploading ? (
                          <div className="flex flex-col items-center justify-center p-1 text-center">
                            <Loader2 className="w-4 h-4 text-[#E5FF3B] animate-spin mb-1" />
                            <span className="text-[7.5px] font-black text-[#A1A1AA]">{uploadProgress[`portfolio-${idx}`]}%</span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => triggerPhotoUpload(idx, "square")}
                            className="absolute inset-0 flex flex-col items-center justify-center text-[#A1A1AA] hover:text-[#E5FF3B]"
                          >
                            <Plus className="w-4 h-4 mb-0.5" />
                            <span className="text-[8px] font-bold uppercase tracking-wider">Slot {idx + 1}</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-5">
            <div className="text-center">
              <h4 className="text-lg font-black tracking-tight text-white">Location Tags</h4>
              <p className="text-xs text-[#A1A1AA] font-medium mt-1">Specify your geological focus region</p>
            </div>

            <div className="space-y-4 text-left">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black uppercase tracking-widest text-[#A1A1AA]">Country</label>
                  <input
                    type="text"
                    required
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full h-11 bg-[#141414] border border-[#2A2A2A] rounded-xl px-4 text-xs font-semibold focus:border-[#E5FF3B] text-white outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black uppercase tracking-widest text-[#A1A1AA]">State / Region</label>
                  <input
                    type="text"
                    required
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    className="w-full h-11 bg-[#141414] border border-[#2A2A2A] rounded-xl px-4 text-xs font-semibold focus:border-[#E5FF3B] text-white outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-black uppercase tracking-widest text-[#A1A1AA]">City</label>
                <input
                  type="text"
                  required
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full h-11 bg-[#141414] border border-[#2A2A2A] rounded-xl px-4 text-xs font-semibold focus:border-[#E5FF3B] text-white outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-black uppercase tracking-widest text-[#A1A1AA]">Custom Location Display (Optional)</label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="e.g. Brooklyn, NY"
                    value={currentLocation}
                    onChange={(e) => setCurrentLocation(e.target.value)}
                    className="w-full h-11 bg-[#141414] border border-[#2A2A2A] rounded-xl px-4 text-xs font-semibold focus:border-[#E5FF3B] text-white pr-10 outline-none placeholder-zinc-600"
                  />
                  <MapPin className="absolute right-3.5 top-3.5 w-4 h-4 text-[#E5FF3B]" />
                </div>
              </div>
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-5">
            <div className="text-center">
              <h4 className="text-lg font-black tracking-tight text-white">About Me & Work</h4>
              <p className="text-xs text-[#A1A1AA] font-medium mt-1">Tell your story and highlight your specialty</p>
            </div>

            <div className="space-y-4 text-left">
              <div className="space-y-1.5">
                <label className="text-[11px] font-black uppercase tracking-widest text-[#A1A1AA]">Short Bio</label>
                <textarea
                  placeholder="Share a creative, funny, or aesthetic introduction..."
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  maxLength={160}
                  className="w-full h-24 bg-[#141414] border border-[#2A2A2A] rounded-2xl p-4 text-xs font-semibold focus:border-[#E5FF3B] text-white outline-none resize-none placeholder-zinc-600"
                />
                <span className="text-[9px] text-[#A1A1AA] block text-right font-bold">{bio.length}/160 characters</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black uppercase tracking-widest text-[#A1A1AA]">Occupation / Specialty</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="e.g. Creative Coder"
                      value={occupation}
                      onChange={(e) => setOccupation(e.target.value)}
                      className="w-full h-11 bg-[#141414] border border-[#2A2A2A] rounded-xl px-4 text-xs font-semibold focus:border-[#E5FF3B] text-white pr-10 outline-none placeholder-zinc-600"
                    />
                    <Briefcase className="absolute right-3.5 top-3.5 w-4 h-4 text-[#A1A1AA]" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black uppercase tracking-widest text-[#A1A1AA]">Education</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="e.g. Parsons School of Design"
                      value={education}
                      onChange={(e) => setEducation(e.target.value)}
                      className="w-full h-11 bg-[#141414] border border-[#2A2A2A] rounded-xl px-4 text-xs font-semibold focus:border-[#E5FF3B] text-white pr-10 outline-none placeholder-zinc-600"
                    />
                    <GraduationCap className="absolute right-3.5 top-3.5 w-4 h-4 text-[#A1A1AA]" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case 5:
        return (
          <div className="space-y-5">
            <div className="text-center">
              <h4 className="text-lg font-black tracking-tight text-white">Languages Spoken</h4>
              <p className="text-xs text-[#A1A1AA] font-medium mt-1">Add the languages you feel comfortable communicating in</p>
            </div>

            <div className="space-y-4 text-left">
              <form onSubmit={handleLanguageAdd} className="flex gap-2.5">
                <input
                  type="text"
                  placeholder="Type a language (e.g. French, Japanese)"
                  value={newLanguage}
                  onChange={(e) => setNewLanguage(e.target.value)}
                  className="flex-1 h-11 bg-[#141414] border border-[#2A2A2A] rounded-xl px-4 text-xs font-semibold focus:border-[#E5FF3B] text-white outline-none placeholder-zinc-600"
                />
                <button
                  type="submit"
                  className="px-5 h-11 bg-[#E5FF3B] text-black font-extrabold rounded-xl text-xs uppercase tracking-wider hover:bg-[#d8f030] active:scale-95 transition"
                >
                  Add
                </button>
              </form>

              <div className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA] block">Your Languages</span>
                <div className="flex flex-wrap gap-2">
                  {languagesSpoken.map((lang) => (
                    <span
                      key={lang}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#E5FF3B]/10 border border-[#E5FF3B]/20 text-[#E5FF3B] text-xs font-bold rounded-full"
                    >
                      <span>{lang}</span>
                      <button
                        type="button"
                        onClick={() => handleLanguageRemove(lang)}
                        className="p-0.5 hover:text-rose-400 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );

      case 6:
        return (
          <div className="space-y-5">
            <div className="text-center">
              <h4 className="text-lg font-black tracking-tight text-white">Aesthetic Interests</h4>
              <p className="text-xs text-[#A1A1AA] font-medium mt-1">Select your favorite hobbies and creative outlets</p>
            </div>

            <div className="space-y-4 text-left">
              <div className="flex flex-wrap gap-1.5 max-h-[250px] overflow-y-auto p-2 border border-[#2A2A2A] bg-[#141414] rounded-2xl custom-scrollbar">
                {INTERESTS_CHIPS.map((chip) => {
                  const isSelected = selectedInterests.includes(chip);
                  return (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => toggleInterest(chip)}
                      className={`text-[10px] font-black uppercase tracking-wider px-3.5 py-2 rounded-full border transition active:scale-95 ${
                        isSelected
                          ? "bg-[#E5FF3B] border-[#E5FF3B] text-black font-extrabold"
                          : "bg-[#1E1E1E] border-[#2A2A2A] text-white hover:border-zinc-700"
                      }`}
                    >
                      {chip}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );

      case 7:
        return (
          <div className="space-y-5">
            <div className="text-center">
              <h4 className="text-lg font-black tracking-tight text-white">Music Preferences</h4>
              <p className="text-xs text-[#A1A1AA] font-medium mt-1">Which visual/auditory soundscapes do you explore?</p>
            </div>

            <div className="space-y-4 text-left">
              <div className="grid grid-cols-2 gap-2 max-h-[250px] overflow-y-auto p-1 custom-scrollbar">
                {MUSIC_CATEGORIES.map((cat) => {
                  const isSelected = selectedMusic.includes(cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => toggleMusic(cat)}
                      className={`h-11 rounded-xl border flex items-center justify-between px-4 transition active:scale-[0.98] ${
                        isSelected
                          ? "bg-[#E5FF3B]/10 border-[#E5FF3B] text-[#E5FF3B] font-extrabold"
                          : "bg-[#141414] border-[#2A2A2A] text-[#A1A1AA] hover:text-white hover:bg-[#1E1E1E] font-semibold"
                      }`}
                    >
                      <span className="text-xs">{cat}</span>
                      <Music className={`w-4 h-4 ${isSelected ? "text-[#E5FF3B]" : "text-zinc-600"}`} />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );

      case 8:
        return (
          <div className="space-y-5">
            <div className="text-center">
              <h4 className="text-lg font-black tracking-tight text-white">Lifestyle & Routine</h4>
              <p className="text-xs text-[#A1A1AA] font-medium mt-1">Share your day-to-day creative habits</p>
            </div>

            <div className="space-y-4 text-left">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black uppercase tracking-widest text-[#A1A1AA]">Smoking</label>
                  <CustomSelector
                    label="Smoking"
                    value={smoking}
                    onChange={setSmoking}
                    options={["Non-smoker", "Social smoker", "Active smoker"]}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black uppercase tracking-widest text-[#A1A1AA]">Drinking</label>
                  <CustomSelector
                    label="Drinking"
                    value={drinking}
                    onChange={setDrinking}
                    options={["Social drinker", "Non-drinker", "Frequent drinker"]}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black uppercase tracking-widest text-[#A1A1AA]">Workout</label>
                  <CustomSelector
                    label="Workout Frequency"
                    value={workoutFrequency}
                    onChange={setWorkoutFrequency}
                    options={["Weekly", "Daily", "Rarely", "Never"]}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black uppercase tracking-widest text-[#A1A1AA]">Height</label>
                  <input
                    type="text"
                    value={height}
                    onChange={(e) => setHeight(e.target.value)}
                    placeholder="e.g. 5ft 11in"
                    className="w-full h-11 bg-[#141414] border border-[#2A2A2A] rounded-xl px-4 text-xs font-semibold focus:border-[#E5FF3B] text-white outline-none placeholder-zinc-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black uppercase tracking-widest text-[#A1A1AA]">Religion</label>
                  <input
                    type="text"
                    value={religion}
                    onChange={(e) => setReligion(e.target.value)}
                    placeholder="e.g. Agnostic, Spiritual"
                    className="w-full h-11 bg-[#141414] border border-[#2A2A2A] rounded-xl px-4 text-xs font-semibold focus:border-[#E5FF3B] text-white outline-none placeholder-zinc-600"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black uppercase tracking-widest text-[#A1A1AA]">Personality Type</label>
                  <input
                    type="text"
                    value={personalityType}
                    onChange={(e) => setPersonalityType(e.target.value)}
                    placeholder="e.g. INFJ, ENFP"
                    className="w-full h-11 bg-[#141414] border border-[#2A2A2A] rounded-xl px-4 text-xs font-semibold focus:border-[#E5FF3B] text-white outline-none placeholder-zinc-600"
                  />
                </div>
              </div>
            </div>
          </div>
        );

      case 9:
        return (
          <div className="space-y-5">
            <div className="text-center">
              <h4 className="text-lg font-black tracking-tight text-white">Review Card & Preview</h4>
              <p className="text-xs text-[#A1A1AA] font-medium mt-1">Here is how other creators will see your card</p>
            </div>

            {/* Aesthetic Card Preview */}
            <div className="max-w-sm mx-auto bg-[#141414] rounded-3xl border border-[#2A2A2A] shadow-2xl overflow-hidden text-left relative">
              {/* Header Cover Banner */}
              <div className="h-28 bg-[#1A1A1A] relative">
                <img src={coverPhotoUrl} alt="Cover Banner" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-black/30 to-transparent" />
                {/* Jump to photos link */}
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="absolute top-3 right-3 px-3 py-1 bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/10 rounded-full text-[8px] font-black uppercase tracking-wider text-white"
                >
                  Edit Media
                </button>
              </div>

              <div className="px-5 pb-5 relative mt-[-2rem] z-10">
                {/* Profile Portrait */}
                <div className="w-16 h-16 rounded-full border-2 border-[#E5FF3B] bg-[#1E1E1E] shadow overflow-hidden relative">
                  <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                </div>

                <div className="mt-2.5">
                  <div className="flex items-center gap-1.5">
                    <h5 className="text-base font-black text-white leading-none">{fullName || "Anvio Creator"}</h5>
                    <span className="text-[10px] text-[#A1A1AA] font-bold">({age || 21})</span>
                    <span className="text-[#E5FF3B] ml-1">
                      <CheckCircle2 className="w-4 h-4 text-[#E5FF3B]" />
                    </span>
                  </div>
                  <span className="text-[10.5px] font-extrabold text-[#E5FF3B] mt-1.5 block">
                    @{username || "creator"} • {occupation || "Specialty"}
                  </span>

                  <p className="text-[11px] text-[#A1A1AA] mt-2 line-clamp-2 italic">"{bio || "No bio specified yet."}"</p>

                  <div className="flex items-center gap-1.5 text-[10px] text-[#A1A1AA] font-bold mt-3">
                    <MapPin className="w-3 h-3 text-[#E5FF3B]" />
                    <span>
                      {city || "New York"}, {state || "NY"}, {country || "USA"}
                    </span>
                  </div>

                  {/* Chosen tag chips */}
                  {selectedInterests.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-3">
                      {selectedInterests.slice(0, 4).map((chip) => (
                        <span
                          key={chip}
                          className="text-[8px] font-extrabold px-2 py-1 bg-[#1E1E1E] border border-[#2A2A2A] text-white rounded-full uppercase tracking-wider"
                        >
                          {chip}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Audio Music Genres preview */}
                  {selectedMusic.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {selectedMusic.slice(0, 3).map((music) => (
                        <span
                          key={music}
                          className="text-[8px] font-bold px-2 py-0.5 bg-[#E5FF3B]/10 text-[#E5FF3B] border border-[#E5FF3B]/20 rounded-full flex items-center gap-1"
                        >
                          <Music className="w-2 h-2" /> {music}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <p className="text-[10px] text-[#A1A1AA] font-bold uppercase tracking-widest text-center mt-3">
              Review and click "Complete Profile" to save your changes
            </p>
          </div>
        );

      default:
        return null;
    }
  };

  // 12 EDIT CARDS RENDERING (FOR EDIT PROFILE MODE)
  const renderEditProfileMode = () => {
    return (
      <div className="space-y-6">
        {/* Intro */}
        <div className="text-center py-2">
          <h4 className="text-xl font-black tracking-tight text-white">Edit Creative Identity</h4>
          <p className="text-xs text-[#A1A1AA] font-medium mt-1">Manage and update specific sections of your creator profile independently</p>
        </div>

        {/* Card 1: Profile Photos */}
        <div className="bg-[#141414] border border-[#2A2A2A] rounded-3xl p-5 shadow-lg text-left">
          {renderReadCardHeader("Profile Photos", Camera, "photos")}
          {editingSections.photos ? (
            <div className="space-y-5">
              {/* Cover Banner */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA]">Cover Banner</span>
                <div className="h-28 rounded-2xl bg-[#1E1E1E] relative overflow-hidden border border-[#2A2A2A]">
                  <img src={coverPhotoUrl} alt="Cover" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <button
                      type="button"
                      onClick={() => triggerPhotoUpload(-1, "cover")}
                      className="px-3.5 py-1.5 bg-[#1E1E1E] text-white border border-[#2A2A2A] rounded-full text-[9px] font-extrabold uppercase tracking-wider shadow hover:bg-[#2A2A2A]"
                    >
                      Choose Cover
                    </button>
                  </div>
                  {uploadProgress["cover"] !== undefined && (
                    <div className="absolute bottom-0 inset-x-0 h-1 bg-[#2A2A2A]">
                      <div className="h-full bg-[#E5FF3B]" style={{ width: `${uploadProgress["cover"]}%` }} />
                    </div>
                  )}
                </div>
              </div>

              {/* Portrait Portrait */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA]">Portrait Portrait</span>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-[#1E1E1E] relative overflow-hidden border border-[#2A2A2A] shrink-0">
                    <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                    {uploadProgress["avatar"] !== undefined && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <Loader2 className="w-4 h-4 text-[#E5FF3B] animate-spin" />
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => triggerPhotoUpload(null, "circle")}
                    className="px-3.5 h-8 bg-[#E5FF3B] text-black font-extrabold rounded-full text-[9px] uppercase tracking-wider hover:bg-[#d8f030]"
                  >
                    Upload Portrait
                  </button>
                </div>
              </div>

              {/* Portfolio Grid */}
              <div className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA] block">Portfolio Photos (Drag to reorder)</span>
                <div className="grid grid-cols-5 gap-2">
                  {[0, 1, 2, 3, 4].map((idx) => {
                    const photo = portfolioPhotos[idx];
                    const isUploading = uploadProgress[`portfolio-${idx}`] !== undefined;
                    return (
                      <div
                        key={idx}
                        draggable={!!photo}
                        onDragStart={(e) => handleDragStart(e, idx)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, idx)}
                        className="aspect-square rounded-xl bg-[#1E1E1E] border border-[#2A2A2A] relative overflow-hidden flex flex-col items-center justify-center cursor-grab"
                      >
                        {photo ? (
                          <>
                            <img src={photo} alt="" className="w-full h-full object-cover pointer-events-none" />
                            <button
                              type="button"
                              onClick={() => deletePortfolioPhoto(idx)}
                              className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 hover:bg-rose-600 flex items-center justify-center text-white"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          </>
                        ) : isUploading ? (
                          <span className="text-[8px] font-bold text-[#E5FF3B]">{uploadProgress[`portfolio-${idx}`]}%</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => triggerPhotoUpload(idx, "square")}
                            className="absolute inset-0 flex items-center justify-center text-[#A1A1AA] hover:text-[#E5FF3B]"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              {renderEditCardFooter("photos")}
            </div>
          ) : (
            <div className="space-y-3.5">
              <div className="h-20 rounded-2xl overflow-hidden border border-[#2A2A2A] relative">
                <img src={coverPhotoUrl} alt="Cover Banner" className="w-full h-full object-cover" />
                <div className="absolute left-4 bottom-[-1.5rem] w-12 h-12 rounded-full border-2 border-[#E5FF3B] overflow-hidden bg-[#1E1E1E] shadow-sm">
                  <img src={avatarUrl} alt="Portrait" className="w-full h-full object-cover" />
                </div>
              </div>
              <div className="pt-3 flex gap-2 overflow-x-auto py-1 custom-scrollbar">
                {portfolioPhotos.map((photo, idx) => (
                  <div key={idx} className="w-12 h-12 rounded-xl overflow-hidden border border-[#2A2A2A] shrink-0">
                    <img src={photo} alt="" className="w-full h-full object-cover" />
                  </div>
                ))}
                {portfolioPhotos.length === 0 && (
                  <span className="text-[10px] text-[#A1A1AA] font-medium italic">No portfolio photos uploaded yet.</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Card 2: Personal Information */}
        <div className="bg-[#141414] border border-[#2A2A2A] rounded-3xl p-5 shadow-lg text-left">
          {renderReadCardHeader("Personal Information", User, "personal")}
          {editingSections.personal ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA]">Full Name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full h-11 bg-[#141414] border border-[#2A2A2A] rounded-xl px-4 text-xs font-semibold focus:border-[#E5FF3B] text-white outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA]">Username</label>
                <div className="relative">
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full h-11 bg-[#141414] border border-[#2A2A2A] rounded-xl px-4 text-xs font-semibold focus:border-[#E5FF3B] text-white outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA]">Date of Birth</label>
                  <CustomDatePicker
                    value={dateOfBirth}
                    onChange={(val) => setDateOfBirth(val)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA]">Gender</label>
                  <CustomSelector
                    label="Gender"
                    value={gender}
                    onChange={setGender}
                    options={["Non-binary", "Female", "Male", "Genderfluid", "Agender", "Other"]}
                  />
                </div>
              </div>
              {renderEditCardFooter("personal")}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-[#A1A1AA] font-extrabold text-[9px] uppercase tracking-wider block">Full Name</span>
                <span className="font-bold text-white mt-0.5 block">{fullName || "Not Specified"}</span>
              </div>
              <div>
                <span className="text-[#A1A1AA] font-extrabold text-[9px] uppercase tracking-wider block">Username</span>
                <span className="font-bold text-[#E5FF3B] mt-0.5 block">@{username || "Not Specified"}</span>
              </div>
              <div className="mt-2.5">
                <span className="text-[#A1A1AA] font-extrabold text-[9px] uppercase tracking-wider block">Age</span>
                <span className="font-bold text-white mt-0.5 block">{age ? `${age} years old` : "Not Specified"}</span>
              </div>
              <div className="mt-2.5">
                <span className="text-[#A1A1AA] font-extrabold text-[9px] uppercase tracking-wider block">Gender</span>
                <span className="font-bold text-white mt-0.5 block">{gender}</span>
              </div>
            </div>
          )}
        </div>

        {/* Card 3: About Me */}
        <div className="bg-[#141414] border border-[#2A2A2A] rounded-3xl p-5 shadow-lg text-left">
          {renderReadCardHeader("About Me", Smile, "about")}
          {editingSections.about ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA]">Intro Bio</label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  maxLength={160}
                  className="w-full h-20 bg-[#141414] border border-[#2A2A2A] rounded-2xl p-3.5 text-xs font-semibold focus:border-[#E5FF3B] text-white outline-none resize-none"
                />
              </div>
              {renderEditCardFooter("about")}
            </div>
          ) : (
            <div>
              <span className="text-[#A1A1AA] font-extrabold text-[9px] uppercase tracking-wider block">Biography</span>
              <p className="text-xs text-[#A1A1AA] font-semibold italic mt-1 leading-relaxed">
                {bio ? `"${bio}"` : "No biography added yet."}
              </p>
            </div>
          )}
        </div>

        {/* Card 4: Location */}
        <div className="bg-[#141414] border border-[#2A2A2A] rounded-3xl p-5 shadow-lg text-left">
          {renderReadCardHeader("Location", MapPin, "location")}
          {editingSections.location ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA]">Country</label>
                  <input
                    type="text"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full h-11 bg-[#141414] border border-[#2A2A2A] rounded-xl px-4 text-xs font-semibold focus:border-[#E5FF3B] text-white outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA]">State</label>
                  <input
                    type="text"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    className="w-full h-11 bg-[#141414] border border-[#2A2A2A] rounded-xl px-4 text-xs font-semibold focus:border-[#E5FF3B] text-white outline-none"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA]">City</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full h-11 bg-[#141414] border border-[#2A2A2A] rounded-xl px-4 text-xs font-semibold focus:border-[#E5FF3B] text-white outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA]">Custom Display Location</label>
                <input
                  type="text"
                  value={currentLocation}
                  onChange={(e) => setCurrentLocation(e.target.value)}
                  placeholder="e.g. Brooklyn, NY"
                  className="w-full h-11 bg-[#141414] border border-[#2A2A2A] rounded-xl px-4 text-xs font-semibold focus:border-[#E5FF3B] text-white outline-none placeholder-zinc-600"
                />
              </div>
              {renderEditCardFooter("location")}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <MapPin className="w-4 h-4 text-[#E5FF3B]" />
              <span>
                {currentLocation || `${city}, ${state}, ${country}`}
              </span>
            </div>
          )}
        </div>

        {/* Card 5: Occupation */}
        <div className="bg-[#141414] border border-[#2A2A2A] rounded-3xl p-5 shadow-lg text-left">
          {renderReadCardHeader("Occupation & Specialty", Briefcase, "occupation")}
          {editingSections.occupation ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA]">Specialty Role</label>
                <input
                  type="text"
                  value={occupation}
                  onChange={(e) => setOccupation(e.target.value)}
                  className="w-full h-11 bg-[#141414] border border-[#2A2A2A] rounded-xl px-4 text-xs font-semibold focus:border-[#E5FF3B] text-white outline-none"
                />
              </div>
              {renderEditCardFooter("occupation")}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <Briefcase className="w-4 h-4 text-[#E5FF3B]" />
              <span>{occupation || "No occupation listed"}</span>
            </div>
          )}
        </div>

        {/* Card 6: Education */}
        <div className="bg-[#141414] border border-[#2A2A2A] rounded-3xl p-5 shadow-lg text-left">
          {renderReadCardHeader("Education", GraduationCap, "education")}
          {editingSections.education ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA]">Institution / Course</label>
                <input
                  type="text"
                  value={education}
                  onChange={(e) => setEducation(e.target.value)}
                  className="w-full h-11 bg-[#141414] border border-[#2A2A2A] rounded-xl px-4 text-xs font-semibold focus:border-[#E5FF3B] text-white outline-none"
                />
              </div>
              {renderEditCardFooter("education")}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <GraduationCap className="w-4 h-4 text-[#E5FF3B]" />
              <span>{education || "No education specified"}</span>
            </div>
          )}
        </div>

        {/* Card 7: Languages */}
        <div className="bg-[#141414] border border-[#2A2A2A] rounded-3xl p-5 shadow-lg text-left">
          {renderReadCardHeader("Languages", Languages, "languages")}
          {editingSections.languages ? (
            <div className="space-y-4">
              <form onSubmit={handleLanguageAdd} className="flex gap-2">
                <input
                  type="text"
                  value={newLanguage}
                  onChange={(e) => setNewLanguage(e.target.value)}
                  placeholder="Add a language..."
                  className="flex-1 h-11 bg-[#141414] border border-[#2A2A2A] rounded-xl px-4 text-xs font-semibold focus:border-[#E5FF3B] text-white outline-none placeholder-zinc-600"
                />
                <button
                  type="submit"
                  className="px-4 h-11 bg-[#E5FF3B] text-black rounded-xl text-xs font-extrabold hover:bg-[#d8f030]"
                >
                  Add
                </button>
              </form>
              <div className="flex flex-wrap gap-2 pt-2">
                {languagesSpoken.map((lang) => (
                  <span
                    key={lang}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#E5FF3B]/10 border border-[#E5FF3B]/20 text-[#E5FF3B] text-xs font-bold rounded-full"
                  >
                    <span>{lang}</span>
                    <button type="button" onClick={() => handleLanguageRemove(lang)}>
                      <X className="w-3 h-3 text-[#E5FF3B]" />
                    </button>
                  </span>
                ))}
              </div>
              {renderEditCardFooter("languages")}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {languagesSpoken.map((lang) => (
                <span
                  key={lang}
                  className="px-3 py-1.5 bg-[#1E1E1E] border border-[#2A2A2A] rounded-full text-xs font-bold text-white"
                >
                  {lang}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Card 8: Interests */}
        <div className="bg-[#141414] border border-[#2A2A2A] rounded-3xl p-5 shadow-lg text-left">
          {renderReadCardHeader("Creator Interests", Sparkles, "interests")}
          {editingSections.interests ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-1.5 max-h-[160px] overflow-y-auto p-2 border border-[#2A2A2A] rounded-xl custom-scrollbar">
                {INTERESTS_CHIPS.map((chip) => {
                  const isSelected = selectedInterests.includes(chip);
                  return (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => toggleInterest(chip)}
                      className={`text-[9px] font-black uppercase tracking-wider px-3 py-1.5 rounded-full border transition ${
                        isSelected
                          ? "bg-[#E5FF3B] border-[#E5FF3B] text-black font-extrabold"
                          : "bg-[#1E1E1E] border-[#2A2A2A] text-white hover:border-zinc-700"
                      }`}
                    >
                      {chip}
                    </button>
                  );
                })}
              </div>
              {renderEditCardFooter("interests")}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {selectedInterests.map((interest) => (
                <span
                  key={interest}
                  className="px-3 py-1 bg-[#E5FF3B]/10 border border-[#E5FF3B]/20 text-[#E5FF3B] text-[10px] font-black uppercase tracking-wider rounded-full"
                >
                  {interest}
                </span>
              ))}
              {selectedInterests.length === 0 && (
                <span className="text-xs text-[#A1A1AA] italic">No interests selected.</span>
              )}
            </div>
          )}
        </div>

        {/* Card 9: Music Preferences */}
        <div className="bg-[#141414] border border-[#2A2A2A] rounded-3xl p-5 shadow-lg text-left">
          {renderReadCardHeader("Music Preferences", Music, "music")}
          {editingSections.music ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-1.5">
                {MUSIC_CATEGORIES.map((cat) => {
                  const isSelected = selectedMusic.includes(cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => toggleMusic(cat)}
                      className={`text-[9px] font-black uppercase tracking-wider px-3 py-2 rounded-full border transition ${
                        isSelected
                          ? "bg-[#E5FF3B] border-[#E5FF3B] text-black font-extrabold"
                          : "bg-[#1E1E1E] border-[#2A2A2A] text-white hover:border-zinc-700"
                      }`}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>
              {renderEditCardFooter("music")}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {selectedMusic.map((music) => (
                <span
                  key={music}
                  className="px-3 py-1 bg-[#E5FF3B]/10 border border-[#E5FF3B]/20 text-[#E5FF3B] text-[10px] font-black uppercase tracking-wider rounded-full flex items-center gap-1"
                >
                  <Music className="w-2.5 h-2.5" /> {music}
                </span>
              ))}
              {selectedMusic.length === 0 && (
                <span className="text-xs text-[#A1A1AA] italic font-medium">No music categories selected.</span>
              )}
            </div>
          )}
        </div>

        {/* Card 10: Lifestyle */}
        <div className="bg-[#141414] border border-[#2A2A2A] rounded-3xl p-5 shadow-lg text-left">
          {renderReadCardHeader("Lifestyle Habits", Activity, "lifestyle")}
          {editingSections.lifestyle ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA]">Smoking</span>
                  <CustomSelector
                    label="Smoking"
                    value={smoking}
                    onChange={setSmoking}
                    options={["Non-smoker", "Social smoker", "Active smoker"]}
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA]">Drinking</span>
                  <CustomSelector
                    label="Drinking"
                    value={drinking}
                    onChange={setDrinking}
                    options={["Social drinker", "Non-drinker", "Frequent drinker"]}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA]">Workout</span>
                  <CustomSelector
                    label="Workout Frequency"
                    value={workoutFrequency}
                    onChange={setWorkoutFrequency}
                    options={["Weekly", "Daily", "Rarely", "Never"]}
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA]">Height</span>
                  <input
                    type="text"
                    value={height}
                    onChange={(e) => setHeight(e.target.value)}
                    className="w-full h-11 bg-[#141414] border border-[#2A2A2A] rounded-xl px-3.5 text-xs font-semibold focus:border-[#E5FF3B] text-white outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA]">Religion</span>
                  <input
                    type="text"
                    value={religion}
                    onChange={(e) => setReligion(e.target.value)}
                    className="w-full h-11 bg-[#141414] border border-[#2A2A2A] rounded-xl px-3.5 text-xs font-semibold focus:border-[#E5FF3B] text-white outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA]">Personality</span>
                  <input
                    type="text"
                    value={personalityType}
                    onChange={(e) => setPersonalityType(e.target.value)}
                    className="w-full h-11 bg-[#141414] border border-[#2A2A2A] rounded-xl px-3.5 text-xs font-semibold focus:border-[#E5FF3B] text-white outline-none"
                  />
                </div>
              </div>
              {renderEditCardFooter("lifestyle")}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4 text-xs font-bold text-white">
              <div>
                <span className="text-[9px] text-[#A1A1AA] uppercase tracking-wider block font-extrabold">Smoking</span>
                <span className="mt-0.5 block">{smoking}</span>
              </div>
              <div>
                <span className="text-[9px] text-[#A1A1AA] uppercase tracking-wider block font-extrabold">Drinking</span>
                <span className="mt-0.5 block">{drinking}</span>
              </div>
              <div>
                <span className="text-[9px] text-[#A1A1AA] uppercase tracking-wider block font-extrabold">Workout</span>
                <span className="mt-0.5 block">{workoutFrequency}</span>
              </div>
              <div className="mt-2.5">
                <span className="text-[9px] text-[#A1A1AA] uppercase tracking-wider block font-extrabold">Height</span>
                <span className="mt-0.5 block">{height}</span>
              </div>
              <div className="mt-2.5">
                <span className="text-[9px] text-[#A1A1AA] uppercase tracking-wider block font-extrabold">Religion</span>
                <span className="mt-0.5 block">{religion || "Not Specified"}</span>
              </div>
              <div className="mt-2.5">
                <span className="text-[9px] text-[#A1A1AA] uppercase tracking-wider block font-extrabold">Personality</span>
                <span className="mt-0.5 block">{personalityType || "Not Specified"}</span>
              </div>
            </div>
          )}
        </div>

        {/* Card 11: Dating Preferences */}
        <div className="bg-[#141414] border border-[#2A2A2A] rounded-3xl p-5 shadow-lg text-left">
          {renderReadCardHeader("Dating & Matching Goals", Heart, "dating")}
          {editingSections.dating ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA]">Interested In</span>
                  <CustomSelector
                    label="Interested In"
                    value={interestedIn}
                    onChange={setInterestedIn}
                    options={["Everyone", "Women", "Men", "Creators"]}
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA]">Relationship Goal</span>
                  <CustomSelector
                    label="Relationship Goal"
                    value={relationshipGoal}
                    onChange={setRelationshipGoal}
                    options={["Friendship", "Serious", "Casual", "Exploring", "Collaborating"]}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA]">Looking For</span>
                  <CustomSelector
                    label="Looking For"
                    value={lookingFor}
                    onChange={setLookingFor}
                    options={["Friendship", "Dating", "Co-creation", "Long Term"]}
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA]">Show Me</span>
                  <CustomSelector
                    label="Show Me"
                    value={showMe}
                    onChange={setShowMe}
                    options={["Everyone", "Non-binary", "Creators Only"]}
                  />
                </div>
              </div>
              {renderEditCardFooter("dating")}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 text-xs font-bold text-white">
              <div>
                <span className="text-[9px] text-[#A1A1AA] uppercase tracking-wider block font-extrabold">Interested In</span>
                <span className="mt-0.5 block">{interestedIn}</span>
              </div>
              <div>
                <span className="text-[9px] text-[#A1A1AA] uppercase tracking-wider block font-extrabold">Relationship Goal</span>
                <span className="mt-0.5 block">{relationshipGoal}</span>
              </div>
              <div className="mt-2.5">
                <span className="text-[9px] text-[#A1A1AA] uppercase tracking-wider block font-extrabold">Looking For</span>
                <span className="mt-0.5 block">{lookingFor}</span>
              </div>
              <div className="mt-2.5">
                <span className="text-[9px] text-[#A1A1AA] uppercase tracking-wider block font-extrabold">Show Me</span>
                <span className="mt-0.5 block">{showMe}</span>
              </div>
            </div>
          )}
        </div>

        {/* Card 12: Privacy */}
        <div className="bg-[#141414] border border-[#2A2A2A] rounded-3xl p-5 shadow-lg text-left">
          {renderReadCardHeader("Privacy & Incognito", Lock, "privacy")}
          {editingSections.privacy ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#A1A1AA]">Profile Visibility</span>
                <CustomSelector
                  label="Profile Visibility"
                  value={visibilitySettings}
                  onChange={setVisibilitySettings}
                  options={["Public", "Private", "Focus"]}
                />
              </div>
              {renderEditCardFooter("privacy")}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <Lock className="w-4 h-4 text-[#E5FF3B]" />
              <span>
                {visibilitySettings === "Public"
                  ? "Public (Show on Discovery Maps & Decks)"
                  : visibilitySettings === "Private"
                  ? "Private (Incognito / Only current matches)"
                  : "Focus Mode (Visible only as away/studying)"}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={`w-full h-full overflow-y-auto custom-scrollbar bg-[#0A0A0A] select-none relative font-sans text-white`}
      style={{
        paddingTop: 'env(safe-area-inset-top, 24px)',
        paddingBottom: 'env(safe-area-inset-bottom, 24px)',
        paddingLeft: '24px',
        paddingRight: '24px'
      }}
    >
      {/* Invisible HTML5 Input for Photos */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*"
        className="hidden"
      />

      {/* Profile setup onboarding stepper progress line */}
      {!isEditing && (
        <div className="absolute top-0 inset-x-0 h-1.5 bg-[#141414] flex overflow-hidden">
          <div
            className="h-full bg-[#E5FF3B] transition-all duration-300"
            style={{ width: `${(step / 9) * 100}%` }}
          />
        </div>
      )}

      {/* Floating Success Notification Toast */}
      <AnimatePresence>
        {successToast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[200] bg-[#141414] text-white text-[11px] font-black uppercase tracking-widest px-6 py-4 rounded-full shadow-2xl flex items-center gap-2 border border-[#2A2A2A]"
          >
            <CheckCircle2 className="w-4 h-4 text-[#E5FF3B]" />
            <span>{successToast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header bar */}
      <div className="flex justify-between items-center mb-5 mt-1">
        <span className="text-[9px] font-black uppercase tracking-widest text-[#E5FF3B]">
          {isEditing ? "CREATOR DASHBOARD PROFILE" : "CREATOR PROFILE ONBOARDING"}
        </span>
        {!isEditing && (
          <div className="flex items-center gap-2.5">
            <span className="text-[10px] font-black text-[#A1A1AA] uppercase">Step {step} of 9</span>
            <button
              type="button"
              onClick={handleSetupLater}
              disabled={loading}
              className="text-[11px] font-black text-[#E5FF3B] hover:bg-[#E5FF3B]/10 px-3 py-1 rounded-full border border-[#E5FF3B]/30 transition cursor-pointer"
            >
              Skip
            </button>
          </div>
        )}
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mb-4 p-4 bg-rose-950/40 border border-rose-800 rounded-2xl flex items-center gap-2.5 text-rose-200 text-xs font-bold text-left animate-pulse">
          <span className="text-sm">⚠️</span>
          <span className="leading-tight">{error}</span>
        </div>
      )}

      {/* Render correct layout */}
      {isEditing ? (
        renderEditProfileMode()
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.15 }}
            className="min-h-[350px]"
          >
            {renderStepContentOnboarding()}
          </motion.div>
        </AnimatePresence>
      )}

      {/* Main Footer Actions for Global Save */}
      <div className="flex gap-3 mt-6 pt-5 border-t border-[#2A2A2A]">
        {isEditing ? (
          <>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="px-6 h-12 border border-[#2A2A2A] hover:bg-[#2A2A2A] text-white rounded-full text-xs font-extrabold uppercase tracking-wider transition-all cursor-pointer"
              >
                Cancel / Exit
              </button>
            )}
            <button
              type="button"
              onClick={handleSaveAllProfile}
              disabled={loading}
              className="flex-1 h-12 bg-[#E5FF3B] hover:bg-[#d8f030] text-black font-extrabold rounded-full text-xs uppercase tracking-wider flex items-center justify-center gap-2 active:scale-[0.98] transition cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-black" />
                  <span>Saving settings...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Save Profile & Close</span>
                </>
              )}
            </button>
          </>
        ) : (
          <>
            {step > 1 && (
              <button
                type="button"
                onClick={handleBack}
                className="px-5 h-12 border border-[#2A2A2A] hover:bg-[#2A2A2A] text-white rounded-full text-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
            )}
            <button
              type="button"
              onClick={handleSetupLater}
              disabled={loading}
              className="px-5 h-12 border border-[#2A2A2A] hover:bg-[#1E1E1E] text-[#A1A1AA] hover:text-white rounded-full text-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={step === 9 ? handleSaveAllProfile : handleNext}
              disabled={loading}
              className="flex-1 h-12 bg-[#E5FF3B] hover:bg-[#d8f030] text-black font-extrabold rounded-full text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 active:scale-[0.98] transition cursor-pointer disabled:opacity-40"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-black" />
                  <span>Processing...</span>
                </>
              ) : step === 9 ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Complete Profile</span>
                </>
              ) : (
                <>
                  <span>Continue</span>
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          </>
        )}
      </div>

      {/* Image Cropper Modal Integration */}
      <ImageCropperModal
        isOpen={cropperOpen}
        imageSrc={cropperImage}
        cropType={cropperType}
        onCancel={() => setCropperOpen(false)}
        onSave={handleCroppedSave}
      />
    </div>
  );
}
