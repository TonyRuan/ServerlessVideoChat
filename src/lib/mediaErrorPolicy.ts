export interface MediaErrorPresentation {
  title: string;
  message: string;
}
export function describeMediaError(error: Error): MediaErrorPresentation {
  if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
    return {
      title: '无法使用摄像头或麦克风',
      message: '设备权限未开启。请在浏览器设置中允许访问后重试，也可以关闭音视频继续。',
    };
  }

  if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
    return {
      title: '没有找到可用的媒体设备',
      message: '请连接摄像头或麦克风后重试，也可以关闭音视频继续。',
    };
  }

  if (error.name === 'NotReadableError' || error.name === 'AbortError') {
    return {
      title: '媒体设备暂时不可用',
      message: '设备可能正被其他应用占用。关闭占用程序后重试，或关闭音视频继续。',
    };
  }

  return {
    title: '媒体设备初始化失败',
    message: '请检查摄像头和麦克风状态后重试，也可以关闭音视频继续。',
  };
}
