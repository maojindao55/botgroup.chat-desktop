/**
 * @Author Awen
 * @Date 2024/05/25
 * @Email wengaolng@gmail.com
 **/

import { useCallback, useEffect, useState } from "react";
import { toast } from 'sonner';
import { request } from '@/utils/request';

export const useClickHandler = (domRef, config) => {
  const [state, setState] = useState({ popoverVisible: false })
  const [data, setData] = useState({})

  const clickEvent = useCallback(() => {
    setState({ ...state, popoverVisible: true })
  }, [state])

  const visibleChangeEvent = useCallback((visible) => {
    setState({ ...state, popoverVisible: visible })
    if (config.onVisibleChange) {
      config.onVisibleChange(visible)
    }
  }, [state, config])

  const closeEvent = useCallback(() => {
    setState({ ...state, popoverVisible: false })
    if (config.onVisibleChange) {
      config.onVisibleChange(false)
    }
  }, [state, config])

  const requestCaptchaData = useCallback(async () => {
    domRef.current.clear && domRef.current.clear()
    try {
      const response = await request(config.getApi)
      const data = await response.json()

      if (data && (data['code'] || 0) === 0) {
        setData({
          image: data['image_base64'] || '',
          thumb: data['thumb_base64'] || '',
          captKey: data['captcha_key'] || ''
        })
      } else {
        toast.error('获取验证码失败')
      }
    } catch (e) {
      console.warn(e)
      toast.error('获取验证码失败')
    }
  }, [config.getApi, setData])

  const refreshEvent = useCallback(() => {
    requestCaptchaData()
  }, [requestCaptchaData])

  const confirmEvent = useCallback(async (dots, clear) => {
    const dotArr = []
    dots.forEach((item) => {
      dotArr.push(item.x, item.y)
    })

    try {
      const formData = new URLSearchParams({
        dots: dotArr.join(','),
        key: data.captKey || '',
        extraData: JSON.stringify(config.extraData),
      })
      const response = await request(config.checkApi, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData
      })

      const responseData = await response.json()

      if ((responseData['code'] || 0) === 0) {
        toast.success(responseData.message)
        setState({ ...state, popoverVisible: false, type: "success" })
        if (config.onVisibleChange) {
          config.onVisibleChange(false)
        }
        if (config.onSuccess) {
          config.onSuccess()
        }
      } else {
        toast.error('验证码验证失败')
        setState({ ...state, type: "error" })
      }

      setTimeout(() => {
        requestCaptchaData()
      }, 1000)
    } catch (e) {
      console.warn(e)
      toast.error('验证码验证失败')
    }
  }, [data, state, setState, config.checkApi, requestCaptchaData])

  useEffect(() => {
    requestCaptchaData()
  }, [requestCaptchaData])

  return {
    state,
    data,
    visibleChangeEvent,
    clickEvent,
    closeEvent,
    refreshEvent,
    confirmEvent,
  }
}
