/**
 * PromptSettings - 系统提示词管理设置页
 *
 * 目前仅展示 Agent 提示词配置和全局增强选项。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import {
  SettingsSection,
  SettingsCard,
  SettingsToggle,
} from './primitives'
import { AgentPromptSettings } from './AgentPromptSettings'
import { promptConfigAtom } from '@/atoms/system-prompt-atoms'

export function PromptSettings(): React.ReactElement {
  const [config, setConfig] = useAtom(promptConfigAtom)

  /** 初始加载配置 */
  React.useEffect(() => {
    window.electronAPI.getSystemPromptConfig().then((cfg) => {
      setConfig(cfg)
    }).catch(console.error)
  }, [setConfig])

  /** 更新追加设置 */
  const handleAppendChange = async (enabled: boolean): Promise<void> => {
    try {
      await window.electronAPI.updateAppendSetting(enabled)
      setConfig((prev) => ({ ...prev, appendDateTimeAndUserName: enabled }))
    } catch (error) {
      console.error('[提示词设置] 更新追加设置失败:', error)
    }
  }

  return (
    <div className="space-y-6">
      {/* Agent 提示词设置 */}
      <AgentPromptSettings />

      {/* 增强选项 */}
      <SettingsSection title="增强选项">
        <SettingsCard>
          <SettingsToggle
            label="追加日期时间和用户名"
            description="在提示词末尾自动追加当前日期时间和用户名"
            checked={config.appendDateTimeAndUserName}
            onCheckedChange={handleAppendChange}
          />
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}
