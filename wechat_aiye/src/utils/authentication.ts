import type { User } from '@/types/models';

export const hasVerifiedPhone = (user: User | null) =>
  !!user && user.is_phone_verified === true && !!user.phone_number?.trim();

export const hasCompletedOnboardingProfile = (user: User | null) =>
  !!user && [user.name, user.gender, user.region, user.photo_url]
    .every(value => typeof value === 'string' && !!value.trim());

export const onboardingDestination = (user: User | null, requiresBinding = false): string | null => {
  if (!user) return '/pages/login/index';
  if (requiresBinding || !hasVerifiedPhone(user)) return '/pages/bind-phone/index';
  if (!hasCompletedOnboardingProfile(user)) return '/pages/profile-edit/index';
  return null;
};
