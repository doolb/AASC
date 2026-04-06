const { MessageBus, getBus, Message, ActorAddress, MessageType, Priority, MessageTopic } = require('./message-bus');
const { Actor, ActorBuilder, ActorStatus, CapabilityCategory } = require('./actor');
const { RoutingRule, MessageRouter, MessageFilter, FilterBuilder } = require('./router');
const { Capability, CapabilityLevel, SecurityLevel, ActorRegistration, ActorRegistry } = require('./registry');
const { User, UserStore, UserRole, PermissionManager } = require('./user');
const { UserRecord, UserRecordStore, RecordCommandParser, RecordType, RecordSource, ImportanceLevel } = require('./record');
const { CapabilityDefinition, ResolvedCapability, CapabilityRegistry, CapabilityBuilder, initDefaultCapabilities } = require('./capability');
const { ClusterNode, ClusterManager, ClusterRouter, EdgeOrchestrator, NodeStatus } = require('./cluster');
const { PipelineStatus, StepErrorStrategy, PipelineContext, PipelineStep, PipelineExecutor, PipelineBuilder } = require('./pipeline');
const { TriggerType, CompositionStatus, Trigger, CapabilityComposition, CompositionRegistry, CompositionExecutor, CompositionBuilder, defaultCompositions, initDefaultCompositions } = require('./composition');
const { ScoreWeight, CategoryWeights, CapabilityScore, ActorLevelScore, CapabilityLevelCalculator, LevelCalculatorBuilder } = require('./level-calculator');

const { MessageParser } = require('./components/message-parser');
const { MessageDispatcher } = require('./components/message-dispatcher');
const { StateManager } = require('./components/state-manager');

const { WebSocketSystem } = require('./system/websocket-system');

const { BaseAgent, AgentBuilder, VoiceCommandAgent, ChatAgent, MediaControlAgent, TTSAgent, ReminderAgent, DisplayRenderAgent, SystemCommandAgent, SearchAgent } = require('./agents');

const { AgentActorAdapter, ActorFactory } = require('./actor-adapter');

const { 
    MiddlewareManager, 
    ValidationMiddleware, 
    LoggingMiddleware, 
    ErrorHandlingMiddleware, 
    AuthenticationMiddleware,
    RateLimitMiddleware, 
    TimeoutMiddleware, 
    DisplayCheckMiddleware, 
    createMiddlewareChain 
} = require('./middleware');

module.exports = {
  MessageBus,
  getBus,
  Message,
  ActorAddress,
  MessageType,
  Priority,
  MessageTopic,
  Actor,
  ActorBuilder,
  ActorStatus,
  CapabilityCategory,
  RoutingRule,
  MessageRouter,
  MessageFilter,
  FilterBuilder,
  Capability,
  CapabilityLevel,
  SecurityLevel,
  ActorRegistration,
  ActorRegistry,
  User,
  UserStore,
  UserRole,
  PermissionManager,
  UserRecord,
  UserRecordStore,
  RecordCommandParser,
  RecordType,
  RecordSource,
  ImportanceLevel,
  CapabilityDefinition,
  ResolvedCapability,
  CapabilityRegistry,
  CapabilityBuilder,
  initDefaultCapabilities,
  ClusterNode,
  ClusterManager,
  ClusterRouter,
  EdgeOrchestrator,
  NodeStatus,
  PipelineStatus,
  StepErrorStrategy,
  PipelineContext,
  PipelineStep,
  PipelineExecutor,
  PipelineBuilder,
  TriggerType,
  CompositionStatus,
  Trigger,
  CapabilityComposition,
  CompositionRegistry,
  CompositionExecutor,
  CompositionBuilder,
  defaultCompositions,
  initDefaultCompositions,
  ScoreWeight,
  CategoryWeights,
  CapabilityScore,
  ActorLevelScore,
  CapabilityLevelCalculator,
  LevelCalculatorBuilder,
  MessageParser,
  MessageDispatcher,
  StateManager,
  WebSocketSystem,
  BaseAgent,
  AgentBuilder,
  VoiceCommandAgent,
  ChatAgent,
  MediaControlAgent,
  TTSAgent,
  ReminderAgent,
  DisplayRenderAgent,
  SystemCommandAgent,
  SearchAgent,
  AgentActorAdapter,
  ActorFactory,
  MiddlewareManager,
  ValidationMiddleware,
  LoggingMiddleware,
  ErrorHandlingMiddleware,
  AuthenticationMiddleware,
  RateLimitMiddleware,
  TimeoutMiddleware,
  DisplayCheckMiddleware,
  createMiddlewareChain
};
