import type Taro from "@tarojs/taro";

const appConfig: Taro.AppConfig = defineAppConfig({
  pages: ["pages/home/index", "pages/status/index"],
  window: {
    navigationStyle: "custom",
    backgroundTextStyle: "light",
    navigationBarBackgroundColor: "#f4f7f6",
    navigationBarTextStyle: "black",
  },
});

export default appConfig;
