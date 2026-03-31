const { CapabilityLevel } = require('./registry');
const { CapabilityCategory } = require('./actor');

const ScoreWeight = {
  BASIC: 0.5,
  PROFESSIONAL: 1.0,
  SPECIAL: 1.5
};

const CategoryWeights = {
  basic: ScoreWeight.BASIC,
  professional: ScoreWeight.PROFESSIONAL,
  special: ScoreWeight.SPECIAL
};

class CapabilityScore {
  constructor(options = {}) {
    this.capabilityId = options.capabilityId || '';
    this.name = options.name || '';
    this.category = options.category || 'basic';
    this.level = options.level || 1;
    this.weight = options.weight || 1.0;
    this.weightedScore = options.weightedScore || 0;
    this.dependencies = options.dependencies || [];
  }

  toJSON() {
    return {
      capabilityId: this.capabilityId,
      name: this.name,
      category: this.category,
      level: this.level,
      weight: this.weight,
      weightedScore: this.weightedScore,
      dependencies: this.dependencies
    };
  }
}

class ActorLevelScore {
  constructor() {
    this.actorId = '';
    this.actorName = '';
    this.capabilities = [];
    this.categoryScores = {
      basic: { count: 0, totalLevel: 0, avgLevel: 0, weightedScore: 0 },
      professional: { count: 0, totalLevel: 0, avgLevel: 0, weightedScore: 0 },
      special: { count: 0, totalLevel: 0, avgLevel: 0, weightedScore: 0 }
    };
    this.maxLevel = 0;
    this.overallLevel = 1;
    this.totalWeightedScore = 0;
    this.complexityScore = 0;
    this.dependencyScore = 0;
    this.recommendations = [];
  }

  addCapability(capScore) {
    this.capabilities.push(capScore);
    
    const category = capScore.category;
    if (this.categoryScores[category]) {
      this.categoryScores[category].count++;
      this.categoryScores[category].totalLevel += capScore.level;
      this.categoryScores[category].weightedScore += capScore.weightedScore;
    }

    if (capScore.level > this.maxLevel) {
      this.maxLevel = capScore.level;
    }

    this.totalWeightedScore += capScore.weightedScore;
  }

  calculate() {
    for (const category of Object.keys(this.categoryScores)) {
      const cat = this.categoryScores[category];
      if (cat.count > 0) {
        cat.avgLevel = cat.totalLevel / cat.count;
      }
    }

    this.complexityScore = this.calculateComplexityScore();
    this.dependencyScore = this.calculateDependencyScore();
    this.overallLevel = this.calculateOverallLevel();
  }

  calculateComplexityScore() {
    let score = 0;
    
    const basicCount = this.categoryScores.basic.count;
    const profCount = this.categoryScores.professional.count;
    const specialCount = this.categoryScores.special.count;
    
    score += Math.min(basicCount, 5) * 0.5;
    score += Math.min(profCount, 3) * 1.0;
    score += Math.min(specialCount, 2) * 1.5;
    
    if (profCount >= 2 && specialCount >= 1) {
      score += 1.0;
    }
    
    return score;
  }

  calculateDependencyScore() {
    let totalDeps = 0;
    for (const cap of this.capabilities) {
      totalDeps += cap.dependencies.length;
    }
    return Math.min(totalDeps * 0.2, 2.0);
  }

  calculateOverallLevel() {
    if (this.maxLevel === 0) {
      return 1;
    }

    let baseLevel = this.maxLevel;
    
    const basicAvg = this.categoryScores.basic.avgLevel || 0;
    const profAvg = this.categoryScores.professional.avgLevel || 0;
    const specialAvg = this.categoryScores.special.avgLevel || 0;
    
    let adjustment = 0;
    
    if (this.categoryScores.professional.count >= 2) {
      adjustment += 0.3;
    }
    if (this.categoryScores.special.count >= 1) {
      adjustment += 0.2;
    }
    if (profAvg >= 3.5) {
      adjustment += 0.2;
    }
    if (specialAvg >= 3) {
      adjustment += 0.3;
    }
    
    adjustment += this.dependencyScore * 0.1;
    
    const finalLevel = Math.round(baseLevel + adjustment);
    return Math.max(1, Math.min(5, finalLevel));
  }

  generateRecommendations() {
    this.recommendations = [];

    if (this.categoryScores.basic.count < 2) {
      this.recommendations.push({
        type: 'capability',
        message: '建议添加更多基础能力以提升稳定性',
        priority: 'medium'
      });
    }

    if (this.maxLevel >= 4 && this.categoryScores.professional.count < 2) {
      this.recommendations.push({
        type: 'capability',
        message: '建议添加更多专业能力以匹配高等级能力',
        priority: 'high'
      });
    }

    if (this.dependencyScore > 1.5) {
      this.recommendations.push({
        type: 'dependency',
        message: '能力依赖较多，建议检查依赖关系',
        priority: 'low'
      });
    }
  }

  toJSON() {
    return {
      actorId: this.actorId,
      actorName: this.actorName,
      capabilities: this.capabilities.map(c => c.toJSON()),
      categoryScores: this.categoryScores,
      maxLevel: this.maxLevel,
      overallLevel: this.overallLevel,
      totalWeightedScore: this.totalWeightedScore,
      complexityScore: this.complexityScore,
      dependencyScore: this.dependencyScore,
      recommendations: this.recommendations
    };
  }
}

class CapabilityLevelCalculator {
  constructor(options = {}) {
    this.capabilityRegistry = options.capabilityRegistry || null;
    this.customWeights = options.customWeights || { ...CategoryWeights };
  }

  setWeight(category, weight) {
    this.customWeights[category] = weight;
  }

  getWeight(category) {
    return this.customWeights[category] || 1.0;
  }

  calculateCapabilityScore(capability) {
    const category = capability.category || 'basic';
    const level = capability.level || 1;
    const weight = this.getWeight(category);
    const weightedScore = level * weight;

    let dependencies = [];
    if (this.capabilityRegistry) {
      dependencies = this.capabilityRegistry.getDependencies(capability.id) || [];
    }

    return new CapabilityScore({
      capabilityId: capability.id,
      name: capability.name,
      category,
      level,
      weight,
      weightedScore,
      dependencies
    });
  }

  calculateActorLevel(actor) {
    const score = new ActorLevelScore();
    
    score.actorId = actor.address ? actor.address.toString() : actor.id || 'unknown';
    score.actorName = actor.address ? actor.address.name : actor.name || 'unnamed';

    const capabilities = actor.capabilities || [];
    
    for (const cap of capabilities) {
      let resolvedCap = cap;
      
      if (this.capabilityRegistry && cap.id) {
        const resolved = this.capabilityRegistry.resolve(cap.id);
        if (resolved) {
          resolvedCap = {
            id: resolved.id,
            name: resolved.name,
            category: resolved.category,
            level: resolved.level
          };
        }
      }
      
      const capScore = this.calculateCapabilityScore(resolvedCap);
      score.addCapability(capScore);
    }

    score.calculate();
    score.generateRecommendations();

    return score;
  }

  calculateMultipleActors(actors) {
    const results = [];
    for (const actor of actors) {
      results.push(this.calculateActorLevel(actor));
    }
    return results;
  }

  calculateSystemLevel(actors) {
    const scores = this.calculateMultipleActors(actors);
    
    const systemScore = {
      totalActors: actors.length,
      actorsByLevel: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      averageLevel: 0,
      maxLevel: 0,
      capabilities: {
        total: 0,
        byCategory: { basic: 0, professional: 0, special: 0 },
        unique: new Set()
      },
      coverage: {
        basic: 0,
        professional: 0,
        special: 0
      },
      recommendations: []
    };

    let totalLevel = 0;
    
    for (const score of scores) {
      systemScore.actorsByLevel[score.overallLevel]++;
      totalLevel += score.overallLevel;
      
      if (score.maxLevel > systemScore.maxLevel) {
        systemScore.maxLevel = score.maxLevel;
      }

      for (const cap of score.capabilities) {
        systemScore.capabilities.total++;
        systemScore.capabilities.byCategory[cap.category]++;
        systemScore.capabilities.unique.add(cap.capabilityId);
      }
    }

    systemScore.averageLevel = actors.length > 0 
      ? totalLevel / actors.length 
      : 0;
    
    systemScore.capabilities.uniqueCount = systemScore.capabilities.unique.size;
    delete systemScore.capabilities.unique;

    systemScore.coverage.basic = this.calculateCoverage(scores, 'basic');
    systemScore.coverage.professional = this.calculateCoverage(scores, 'professional');
    systemScore.coverage.special = this.calculateCoverage(scores, 'special');

    systemScore.recommendations = this.generateSystemRecommendations(systemScore);

    return systemScore;
  }

  calculateCoverage(scores, category) {
    const actorsWithCategory = scores.filter(s => 
      s.categoryScores[category].count > 0
    ).length;
    return scores.length > 0 
      ? (actorsWithCategory / scores.length) * 100 
      : 0;
  }

  generateSystemRecommendations(systemScore) {
    const recommendations = [];

    if (systemScore.coverage.basic < 80) {
      recommendations.push({
        type: 'coverage',
        message: '基础能力覆盖率较低，建议增加基础能力执行者',
        priority: 'high'
      });
    }

    if (systemScore.coverage.professional < 50) {
      recommendations.push({
        type: 'coverage',
        message: '专业能力覆盖率不足，建议增加专业能力执行者',
        priority: 'medium'
      });
    }

    if (systemScore.averageLevel < 2.5) {
      recommendations.push({
        type: 'level',
        message: '系统平均能力等级较低，建议提升执行者能力等级',
        priority: 'medium'
      });
    }

    if (systemScore.actorsByLevel[5] === 0 && systemScore.actorsByLevel[4] === 0) {
      recommendations.push({
        type: 'level',
        message: '系统缺少高等级能力执行者，建议添加L4/L5级能力',
        priority: 'low'
      });
    }

    return recommendations;
  }

  compareActors(actor1, actor2) {
    const score1 = this.calculateActorLevel(actor1);
    const score2 = this.calculateActorLevel(actor2);

    return {
      actor1: score1.toJSON(),
      actor2: score2.toJSON(),
      comparison: {
        overallLevelDiff: score1.overallLevel - score2.overallLevel,
        maxLevelDiff: score1.maxLevel - score2.maxLevel,
        complexityDiff: score1.complexityScore - score2.complexityScore,
        winner: score1.overallLevel > score2.overallLevel ? 'actor1' : 
                score1.overallLevel < score2.overallLevel ? 'actor2' : 'tie'
      }
    };
  }

  rankActors(actors) {
    const scores = actors.map(actor => ({
      actor,
      score: this.calculateActorLevel(actor)
    }));

    scores.sort((a, b) => {
      if (b.score.overallLevel !== a.score.overallLevel) {
        return b.score.overallLevel - a.score.overallLevel;
      }
      return b.score.totalWeightedScore - a.score.totalWeightedScore;
    });

    return scores.map((item, index) => ({
      rank: index + 1,
      actorId: item.score.actorId,
      actorName: item.score.actorName,
      overallLevel: item.score.overallLevel,
      maxLevel: item.score.maxLevel,
      totalWeightedScore: item.score.totalWeightedScore
    }));
  }

  findBestActorForCapability(actors, capabilityId) {
    const candidates = actors.filter(actor => 
      actor.capabilities && actor.capabilities.some(c => c.id === capabilityId)
    );

    if (candidates.length === 0) {
      return null;
    }

    if (candidates.length === 1) {
      return candidates[0];
    }

    const ranked = this.rankActors(candidates);
    const bestId = ranked[0].actorId;
    
    return candidates.find(a => 
      (a.address && a.address.toString() === bestId) || 
      a.id === bestId
    );
  }
}

class LevelCalculatorBuilder {
  constructor() {
    this.options = {};
  }

  withCapabilityRegistry(registry) {
    this.options.capabilityRegistry = registry;
    return this;
  }

  withCustomWeights(weights) {
    this.options.customWeights = weights;
    return this;
  }

  build() {
    return new CapabilityLevelCalculator(this.options);
  }
}

module.exports = {
  ScoreWeight,
  CategoryWeights,
  CapabilityScore,
  ActorLevelScore,
  CapabilityLevelCalculator,
  LevelCalculatorBuilder
};
