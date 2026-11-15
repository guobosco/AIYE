export default defineAppConfig({
  pages: [
    'pages/home/index', 'pages/wishlist/index', 'pages/messages/index', 'pages/mine/index',
    'pages/service-detail/index', 'pages/experience-detail/index', 'pages/category/index',
    'pages/search/index', 'pages/thread/index', 'pages/login/index', 'pages/bind-phone/index', 'pages/profile/index',
    'pages/profile-edit/index', 'pages/publish/index', 'pages/published/index',
    'pages/payment/index', 'pages/activity/index', 'pages/calendar/index',
    'pages/orders/index', 'pages/settings/index', 'pages/verification/index', 'pages/consultation/index',
  ],
  permission: { 'scope.userLocation': { desc: '用于选择服务地点和发送聊天位置' } },
  requiredPrivateInfos: ['chooseLocation'],
  window: {
    backgroundTextStyle: 'dark',
    navigationBarBackgroundColor: '#FFFFFF',
    navigationBarTitleText: '爱野',
    navigationBarTextStyle: 'black',
    backgroundColor: '#FFFFFF',
  },
  tabBar: {
    color: '#7B707A', selectedColor: '#E0115F', backgroundColor: '#FFFFFF', borderStyle: 'white',
    list: [
      { pagePath: 'pages/home/index', text: '爱野', iconPath: 'assets/tabbar/home.svg', selectedIconPath: 'assets/tabbar/home-selected.svg' },
      { pagePath: 'pages/wishlist/index', text: '心愿单', iconPath: 'assets/tabbar/wishlist.svg', selectedIconPath: 'assets/tabbar/wishlist-selected.svg' },
      { pagePath: 'pages/messages/index', text: '消息', iconPath: 'assets/tabbar/messages.svg', selectedIconPath: 'assets/tabbar/messages-selected.svg' },
      { pagePath: 'pages/mine/index', text: '我的', iconPath: 'assets/tabbar/mine.svg', selectedIconPath: 'assets/tabbar/mine-selected.svg' },
    ],
  },
});
