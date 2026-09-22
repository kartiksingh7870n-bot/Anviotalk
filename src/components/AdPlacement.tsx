import React from 'react';

/**
 * Ad placement slots used across the app. Adsterra CPM ads have been removed.
 * Placeholder kept so existing call sites keep working; renders nothing.
 * When a new ad network (e.g. AdMob) is ready, implement it here.
 */
export type PlacementType =
  | 'home_feed'
  | 'discover_swipe'
  | 'other_profile'
  | 'notifications'
  | 'chat_list'
  | 'chat_inbox'
  | 'group_chat'
  | 'stories_feed'
  | 'story_viewer'
  | 'own_profile';

export type AdFormat =
  | 'banner'
  | 'inline-card'
  | 'fullscreen-card'
  | 'video-banner'
  | 'native-banner'
  | 'skyscraper'
  | 'half-skyscraper'
  | 'leaderboard';

interface AdPlacementProps {
  placement: PlacementType;
  format?: AdFormat;
  className?: string;
  adIndex?: number;
  creatorId?: string;
  onAdClick?: (ad: any) => void;
  onAdLoaded?: () => void;
  onAdFailed?: () => void;
}

export default function AdPlacement(_props: AdPlacementProps): React.ReactElement | null {
  return null;
}
