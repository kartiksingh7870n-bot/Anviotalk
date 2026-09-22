import React from 'react';

interface SkeletonProps {
  className?: string;
}

/**
 * Base Shimmer Box element with subtle pulse & smooth gradient
 */
export const SkeletonBox: React.FC<SkeletonProps> = ({ className = '' }) => {
  return (
    <div
      className={`bg-gradient-to-r from-[#18181b] via-[#27272a] to-[#18181b] bg-[length:200%_100%] animate-pulse rounded-xl ${className}`}
    />
  );
};

/**
 * Skeleton for Home Feed Post Cards (CreatorFeedCard)
 */
export const PostCardSkeleton: React.FC = () => {
  return (
    <div className="w-full bg-[#09090b] border-b border-[#27272a]/40 p-4 space-y-3 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <SkeletonBox className="w-11 h-11 rounded-full shrink-0" />
          <div className="space-y-1.5">
            <SkeletonBox className="w-28 h-3.5 rounded-md" />
            <SkeletonBox className="w-20 h-2.5 rounded-md" />
          </div>
        </div>
        <SkeletonBox className="w-16 h-7 rounded-full" />
      </div>

      {/* Main Media Box */}
      <SkeletonBox className="w-full h-72 rounded-2xl" />

      {/* Action Bar */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center space-x-4">
          <SkeletonBox className="w-6 h-6 rounded-full" />
          <SkeletonBox className="w-6 h-6 rounded-full" />
          <SkeletonBox className="w-6 h-6 rounded-full" />
        </div>
        <SkeletonBox className="w-6 h-6 rounded-full" />
      </div>

      {/* Caption & Metadata */}
      <div className="space-y-1.5 pt-1">
        <SkeletonBox className="w-3/4 h-3 rounded-md" />
        <SkeletonBox className="w-1/2 h-3 rounded-md" />
      </div>
    </div>
  );
};

/**
 * Skeleton for Discover Swipe Cards (SwipeCards)
 */
export const DiscoverCardSkeleton: React.FC = () => {
  return (
    <div className="w-full h-full max-w-md mx-auto p-4 flex flex-col justify-between relative bg-[#09090b]">
      {/* Top Bar Skeleton */}
      <div className="flex items-center justify-between z-10">
        <SkeletonBox className="w-24 h-6 rounded-full" />
        <SkeletonBox className="w-20 h-6 rounded-full" />
      </div>

      {/* Card Skeleton */}
      <div className="relative w-full flex-1 my-4 rounded-[2.5rem] bg-[#141414] border border-[#27272a] p-6 flex flex-col justify-between overflow-hidden shadow-2xl">
        <SkeletonBox className="absolute inset-0 w-full h-full rounded-[2.5rem]" />

        {/* Floating Top Badge */}
        <div className="relative z-10 flex justify-between items-center">
          <SkeletonBox className="w-20 h-6 rounded-full" />
          <SkeletonBox className="w-10 h-10 rounded-full" />
        </div>

        {/* Bottom Details Skeleton */}
        <div className="relative z-10 space-y-3 bg-[#0A0A0A]/80 backdrop-blur-md p-5 rounded-3xl border border-[#27272a]/60">
          <div className="flex items-center space-x-3">
            <SkeletonBox className="w-12 h-12 rounded-full" />
            <div className="space-y-1.5 flex-1">
              <SkeletonBox className="w-32 h-4 rounded-md" />
              <SkeletonBox className="w-20 h-3 rounded-md" />
            </div>
          </div>
          <SkeletonBox className="w-full h-3 rounded-md" />
          <div className="flex gap-2">
            <SkeletonBox className="w-16 h-5 rounded-full" />
            <SkeletonBox className="w-16 h-5 rounded-full" />
            <SkeletonBox className="w-16 h-5 rounded-full" />
          </div>
        </div>
      </div>

      {/* Bottom Action Controls */}
      <div className="flex items-center justify-center space-x-6 pb-4 z-10">
        <SkeletonBox className="w-14 h-14 rounded-full" />
        <SkeletonBox className="w-16 h-16 rounded-full" />
        <SkeletonBox className="w-14 h-14 rounded-full" />
      </div>
    </div>
  );
};

/**
 * Skeleton for Story Bubbles (Home Bar & Chat Header)
 */
export const StoryCircleSkeleton: React.FC = () => {
  return (
    <div className="flex flex-col items-center flex-shrink-0 space-y-1.5 w-16">
      <SkeletonBox className="w-16 h-16 rounded-full border-2 border-[#27272a]" />
      <SkeletonBox className="w-12 h-2.5 rounded-md" />
    </div>
  );
};

export const StoryRowSkeleton: React.FC = () => {
  return (
    <div className="flex gap-4 overflow-x-auto no-scrollbar py-2 px-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <StoryCircleSkeleton key={i} />
      ))}
    </div>
  );
};

/**
 * Skeleton for Stories Feed Page (StoriesFeedScreen)
 */
export const StoryGridSkeleton: React.FC = () => {
  return (
    <div className="w-full h-full max-w-[480px] mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <SkeletonBox className="w-36 h-4 rounded-md" />
        <SkeletonBox className="w-8 h-8 rounded-full" />
      </div>

      {/* Spotlight Card */}
      <SkeletonBox className="w-full h-80 rounded-[2rem]" />

      {/* 2x2 Grid */}
      <div className="grid grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBox key={i} className="w-full h-52 rounded-2xl" />
        ))}
      </div>
    </div>
  );
};

/**
 * Skeleton for Chat List Item (ChatWindow)
 */
export const ChatListItemSkeleton: React.FC = () => {
  return (
    <div className="w-full flex items-center justify-between p-3.5 bg-[#141414]/50 border border-[#27272a]/30 rounded-2xl my-1.5 space-x-3">
      <SkeletonBox className="w-12 h-12 rounded-full shrink-0" />
      <div className="flex-1 space-y-2 min-w-0">
        <div className="flex justify-between items-center">
          <SkeletonBox className="w-28 h-3.5 rounded-md" />
          <SkeletonBox className="w-10 h-2.5 rounded-md" />
        </div>
        <SkeletonBox className="w-3/4 h-3 rounded-md" />
      </div>
    </div>
  );
};

export const ChatListSkeletonGroup: React.FC<{ count?: number }> = ({ count = 5 }) => {
  return (
    <div className="w-full space-y-2 py-2">
      {Array.from({ length: count }).map((_, i) => (
        <ChatListItemSkeleton key={i} />
      ))}
    </div>
  );
};

/**
 * Skeleton for Active Conversation Messages (ChatWindow)
 */
export const ChatMessageSkeleton: React.FC = () => {
  return (
    <div className="w-full space-y-4 p-4">
      <div className="flex items-start space-x-2.5">
        <SkeletonBox className="w-8 h-8 rounded-full shrink-0" />
        <SkeletonBox className="w-48 h-12 rounded-2xl rounded-tl-none" />
      </div>
      <div className="flex items-end justify-end space-x-2.5">
        <SkeletonBox className="w-56 h-14 rounded-2xl rounded-tr-none" />
      </div>
      <div className="flex items-start space-x-2.5">
        <SkeletonBox className="w-8 h-8 rounded-full shrink-0" />
        <SkeletonBox className="w-36 h-10 rounded-2xl rounded-tl-none" />
      </div>
    </div>
  );
};

/**
 * Skeleton for Notifications List Item (NotificationsTab)
 */
export const NotificationItemSkeleton: React.FC = () => {
  return (
    <div className="w-full flex items-center justify-between p-4 bg-[#141414] border border-[#27272a]/40 rounded-2xl my-2 space-x-3">
      <SkeletonBox className="w-11 h-11 rounded-full shrink-0" />
      <div className="flex-1 space-y-2">
        <SkeletonBox className="w-36 h-3.5 rounded-md" />
        <SkeletonBox className="w-4/5 h-3 rounded-md" />
      </div>
      <SkeletonBox className="w-12 h-3 rounded-md" />
    </div>
  );
};

/**
 * Skeleton for User Profile View (ProfileTab & ProfileDetailPopup)
 */
export const ProfileSkeleton: React.FC = () => {
  return (
    <div className="w-full max-w-lg mx-auto p-4 space-y-6 bg-[#09090b] font-sans">
      {/* Cover & Avatar Header */}
      <div className="relative w-full h-44 rounded-3xl overflow-hidden bg-[#141414]">
        <SkeletonBox className="w-full h-full" />
        <div className="absolute -bottom-5 left-6">
          <SkeletonBox className="w-20 h-20 rounded-full border-4 border-[#09090b]" />
        </div>
      </div>

      {/* User Info Lines */}
      <div className="pt-2 space-y-2.5">
        <SkeletonBox className="w-40 h-5 rounded-md" />
        <SkeletonBox className="w-24 h-3.5 rounded-md" />
        <SkeletonBox className="w-full h-12 rounded-xl" />
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3">
        <SkeletonBox className="h-16 rounded-2xl" />
        <SkeletonBox className="h-16 rounded-2xl" />
        <SkeletonBox className="h-16 rounded-2xl" />
      </div>

      {/* Portfolio Grid */}
      <div className="grid grid-cols-3 gap-2 pt-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonBox key={i} className="aspect-square rounded-xl" />
        ))}
      </div>
    </div>
  );
};

/**
 * Skeleton for Search Results (SearchScreen)
 */
export const SearchResultSkeleton: React.FC = () => {
  return (
    <div className="w-full flex items-center justify-between p-3.5 bg-[#141414] border border-[#27272a]/50 rounded-2xl my-2">
      <div className="flex items-center space-x-3">
        <SkeletonBox className="w-12 h-12 rounded-full shrink-0" />
        <div className="space-y-1.5">
          <SkeletonBox className="w-32 h-3.5 rounded-md" />
          <SkeletonBox className="w-24 h-2.5 rounded-md" />
        </div>
      </div>
      <SkeletonBox className="w-20 h-8 rounded-xl" />
    </div>
  );
};

/**
 * Image Placeholder with Fade-In Effect once image is loaded
 */
export const ProgressiveImage: React.FC<{
  src: string;
  alt?: string;
  className?: string;
  fallbackSrc?: string;
  onClick?: () => void;
}> = ({ src, alt = '', className = '', fallbackSrc, onClick }) => {
  const [isLoaded, setIsLoaded] = React.useState(false);
  const [hasError, setHasError] = React.useState(false);

  return (
    <div className={`relative overflow-hidden ${className}`} onClick={onClick}>
      {!isLoaded && !hasError && (
        <SkeletonBox className="absolute inset-0 w-full h-full z-10" />
      )}
      <img
        src={hasError && fallbackSrc ? fallbackSrc : src}
        alt={alt}
        loading="lazy"
        onLoad={() => setIsLoaded(true)}
        onError={() => {
          setHasError(true);
          setIsLoaded(true);
        }}
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
};
