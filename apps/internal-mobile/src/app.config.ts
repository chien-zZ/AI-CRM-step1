import type Taro from "@tarojs/taro";

const appConfig: Taro.AppConfig = defineAppConfig({
  pages: [
    "pages/home/index",
    "pages/tasks/index",
    "pages/notifications/index",
    "pages/forms/index",
    "pages/status/index",
  ],
  window: {
    navigationStyle: "custom",
    backgroundTextStyle: "light",
    navigationBarBackgroundColor: "#f5f7fa",
    navigationBarTextStyle: "black",
  },
});

export default appConfig;
