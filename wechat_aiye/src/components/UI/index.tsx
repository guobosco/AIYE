import React, { useEffect, useState } from 'react';
import { Button, Image, Text, View } from '@tarojs/components';
import classnames from 'classnames';
import { mediaUrl } from '@/services/api';
import styles from './index.module.scss';

export const ActionButton = ({ children, onClick, outline = false, small = false, loading = false, disabled = false, openType }: {
  children: React.ReactNode; onClick?: () => void; outline?: boolean; small?: boolean; loading?: boolean; disabled?: boolean;
  openType?: 'share';
}) => <Button className={classnames(styles.button, outline && styles.outline, small && styles.small)}
  loading={loading} disabled={disabled || loading} onClick={onClick} openType={openType}>{children}</Button>;

export const StateView = ({ loading, error, empty, title = '暂无内容', message, onRetry, onLogin }: {
  loading?: boolean; error?: string; empty?: boolean; title?: string; message?: string; onRetry?: () => void; onLogin?: () => void;
}) => {
  if (!loading && !error && !empty && !onLogin) return null;
  return <View className={styles.state}>
    <Text className={styles.stateTitle}>{loading ? '加载中…' : error ? '加载失败' : onLogin ? '登录后查看' : title}</Text>
    {(error || message) && <Text className={styles.stateMessage}>{error || message}</Text>}
    {!loading && (onRetry || onLogin) && <View className={styles.stateAction}>
      <ActionButton outline onClick={onLogin || onRetry}>{onLogin ? '登录' : '重试'}</ActionButton>
    </View>}
  </View>;
};
export const Avatar = ({ url, name = '', size = 88 }: { url?: string; name?: string; size?: number }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return <View className={styles.avatar} style={{ width: `${size}rpx`, height: `${size}rpx`, fontSize: `${size / 2.5}rpx` }}>
    {url && !failed ? <Image className={styles.avatarImage} src={mediaUrl(url)} mode="aspectFill"
      onError={() => { console.error('[Avatar] Image failed'); setFailed(true); }} /> : <Text>{name.slice(0, 1) || '野'}</Text>}
  </View>;
};
export const MenuRow = ({ label, value, onClick, arrow = true }: {
  label: string; value?: string; onClick?: () => void; arrow?: boolean;
}) => <View className={styles.row} onClick={onClick}>
  <Text className={styles.rowLabel}>{label}</Text>
  {value && <Text className={styles.rowValue}>{value}</Text>}
  {arrow && <Text className={styles.rowArrow}>›</Text>}
</View>;
export const Tags = ({ values, selected, onToggle }: { values: string[]; selected?: string[]; onToggle?: (value: string) => void }) =>
  <View className={styles.tags}>{values.map(value => <View key={value}
    className={classnames(styles.tag, selected?.includes(value) && styles.selected)} onClick={() => onToggle?.(value)}>{value}</View>)}</View>;
export default StateView;
