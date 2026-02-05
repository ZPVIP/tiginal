import React from 'react';
import { clsx } from 'clsx';
import { motion } from 'framer-motion';

interface Tab {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (id: string) => void;
  className?: string;
  disableMotion?: boolean;
}

export function Tabs({ tabs, activeTab, onChange, className, disableMotion }: TabsProps) {
  return (
    <div className={clsx("flex flex-col space-y-1", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={clsx(
            "relative flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors",
            activeTab === tab.id
              ? "text-text-main"
              : "text-text-sec hover:text-text-main hover:bg-surface-light"
          )}
        >
          {activeTab === tab.id && (
            disableMotion ? (
              <div className="absolute inset-0 bg-primary/20 rounded-md" />
            ) : (
              <motion.div
                layoutId="activeTab"
                className="absolute inset-0 bg-primary/20 rounded-md"
                initial={false}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              />
            )
          )}
          <span className="relative z-10 flex items-center gap-2">
            {tab.icon}
            {tab.label}
          </span>
        </button>
      ))}
    </div>
  );
}
