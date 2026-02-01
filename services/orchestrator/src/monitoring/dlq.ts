import { ServiceBusClient } from "@azure/service-bus";
import type { Logger } from "pino";

/**
 * Queue names that have dead letter queues
 */
const MONITORED_QUEUES = [
  "agent-tasks-high",
  "agent-tasks",
  "agent-tasks-low",
  "agent-results",
] as const;

type MonitoredQueue = (typeof MONITORED_QUEUES)[number];

/**
 * DLQ statistics for a single queue
 */
export interface DlqStats {
  queueName: string;
  messageCount: number;
  oldestMessageAge?: number; // milliseconds
  newestMessageAge?: number;
}

/**
 * Summary of all DLQ statistics
 */
export interface DlqSummary {
  totalMessages: number;
  queues: DlqStats[];
  lastChecked: string;
}

/**
 * Dead Letter Queue monitoring service
 */
export class DlqMonitor {
  private client: ServiceBusClient;
  private logger: Logger;
  private checkInterval?: ReturnType<typeof setInterval>;

  constructor(client: ServiceBusClient, logger: Logger) {
    this.client = client;
    this.logger = logger.child({ component: "dlq-monitor" });
  }

  /**
   * Start periodic DLQ monitoring
   */
  startMonitoring(intervalMs: number = 60000): void {
    if (this.checkInterval) {
      this.logger.warn("DLQ monitoring already started");
      return;
    }

    this.logger.info({ intervalMs }, "Starting DLQ monitoring");

    // Initial check
    this.checkAll().catch((err) =>
      this.logger.error({ err }, "Initial DLQ check failed"),
    );

    // Periodic checks
    this.checkInterval = setInterval(() => {
      this.checkAll().catch((err) =>
        this.logger.error({ err }, "DLQ check failed"),
      );
    }, intervalMs);
  }

  /**
   * Stop periodic monitoring
   */
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
      this.logger.info("DLQ monitoring stopped");
    }
  }

  /**
   * Get DLQ statistics for all monitored queues
   */
  async getStats(): Promise<DlqSummary> {
    const queues: DlqStats[] = [];
    let totalMessages = 0;

    for (const queueName of MONITORED_QUEUES) {
      try {
        const stats = await this.getQueueStats(queueName);
        queues.push(stats);
        totalMessages += stats.messageCount;
      } catch (err) {
        this.logger.error({ queueName, err }, "Failed to get DLQ stats");
        queues.push({ queueName, messageCount: -1 });
      }
    }

    return {
      totalMessages,
      queues,
      lastChecked: new Date().toISOString(),
    };
  }

  /**
   * Get DLQ stats for a single queue
   */
  private async getQueueStats(queueName: string): Promise<DlqStats> {
    // Create receiver for the dead letter sub-queue
    const dlqPath = `${queueName}/$DeadLetterQueue`;
    const receiver = this.client.createReceiver(dlqPath, {
      receiveMode: "peekLock",
    });

    try {
      // Peek messages to count them and check ages
      const messages = await receiver.peekMessages(100);

      let oldestMessageAge: number | undefined;
      let newestMessageAge: number | undefined;

      const now = Date.now();

      for (const msg of messages) {
        if (msg.enqueuedTimeUtc) {
          const age = now - msg.enqueuedTimeUtc.getTime();

          if (oldestMessageAge === undefined || age > oldestMessageAge) {
            oldestMessageAge = age;
          }
          if (newestMessageAge === undefined || age < newestMessageAge) {
            newestMessageAge = age;
          }
        }
      }

      return {
        queueName,
        messageCount: messages.length,
        oldestMessageAge,
        newestMessageAge,
      };
    } finally {
      await receiver.close();
    }
  }

  /**
   * Check all DLQs and log warnings if messages are found
   */
  private async checkAll(): Promise<void> {
    const stats = await this.getStats();

    if (stats.totalMessages > 0) {
      this.logger.warn(
        { totalMessages: stats.totalMessages, queues: stats.queues },
        "Dead letter queue messages detected",
      );

      // Log individual queues with messages
      for (const queue of stats.queues) {
        if (queue.messageCount > 0) {
          this.logger.warn(
            {
              queueName: queue.queueName,
              messageCount: queue.messageCount,
              oldestAgeMinutes: queue.oldestMessageAge
                ? Math.round(queue.oldestMessageAge / 60000)
                : undefined,
            },
            "DLQ has messages",
          );
        }
      }
    }
  }

  /**
   * Reprocess messages from a DLQ back to the main queue
   */
  async reprocessMessages(
    queueName: MonitoredQueue,
    maxMessages: number = 10,
  ): Promise<{ processed: number; failed: number }> {
    const dlqPath = `${queueName}/$DeadLetterQueue`;
    const receiver = this.client.createReceiver(dlqPath, {
      receiveMode: "peekLock",
    });
    const sender = this.client.createSender(queueName);

    let processed = 0;
    let failed = 0;

    try {
      const messages = await receiver.receiveMessages(maxMessages, {
        maxWaitTimeInMs: 5000,
      });

      for (const msg of messages) {
        try {
          // Re-send to main queue
          await sender.sendMessages({
            body: msg.body,
            contentType: msg.contentType,
            messageId: msg.messageId,
            applicationProperties: {
              ...msg.applicationProperties,
              reprocessedAt: new Date().toISOString(),
              reprocessedFrom: "dlq",
            },
          });

          // Complete the DLQ message
          await receiver.completeMessage(msg);
          processed++;

          this.logger.info(
            {
              queueName,
              messageId: msg.messageId,
            },
            "Reprocessed DLQ message",
          );
        } catch (err) {
          failed++;
          this.logger.error(
            {
              queueName,
              messageId: msg.messageId,
              err,
            },
            "Failed to reprocess DLQ message",
          );
        }
      }
    } finally {
      await receiver.close();
      await sender.close();
    }

    return { processed, failed };
  }

  /**
   * Purge all messages from a DLQ
   */
  async purgeQueue(queueName: MonitoredQueue): Promise<number> {
    const dlqPath = `${queueName}/$DeadLetterQueue`;
    const receiver = this.client.createReceiver(dlqPath, {
      receiveMode: "receiveAndDelete",
    });

    let purged = 0;

    try {
      while (true) {
        const messages = await receiver.receiveMessages(100, {
          maxWaitTimeInMs: 1000,
        });

        if (messages.length === 0) break;
        purged += messages.length;
      }
    } finally {
      await receiver.close();
    }

    this.logger.info({ queueName, purged }, "Purged DLQ messages");
    return purged;
  }
}

/**
 * Create a DLQ monitor instance
 */
export function createDlqMonitor(
  client: ServiceBusClient,
  logger: Logger,
): DlqMonitor {
  return new DlqMonitor(client, logger);
}
