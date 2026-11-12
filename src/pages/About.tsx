import { ScreenHead } from '../components/Common'
import { navigate } from '../lib/route'
import { APP } from '../data/config'

const DAYS = [
  {
    time: '06:20',
    title: '天亮之前',
    text: '上一顿奶是 03:40。你在半梦半醒间按下开始计时，又睡着了。Nestory 不吵你，也不催你填完。',
  },
  {
    time: '09:40',
    title: '第一次翻身',
    text: '你来不及拍视频，只拍到一只模糊的脚。这张照片后来被放进了相册里的「第一次翻身」。',
  },
  {
    time: '15:00',
    title: '外婆的视频',
    text: '她在另一个城市，打开相册看见今天的新照片，留言说：下巴好像又圆了一点。',
  },
  {
    time: '22:30',
    title: '最后一顿奶',
    text: '你写下一句「今天也长得很好」。这句话后来成了这一天的标题。',
  },
]

export default function AboutPage() {
  return (
    <div className="page page--sub">
      <ScreenHead title="关于 Nestory" sub="OUR STORY" back="profile" />
      <div className="page__body" style={{ paddingBottom: 56 }}>
        <div className="about-cover">
          <img src="/assets/photos/hero.jpg" alt="宝宝在巢形的摇篮里安睡" />
          <span className="about-cover__veil" />
          <div className="about-cover__text">
            <span className="eyebrow">Nest + Story</span>
            <p>家，是孩子认识世界的第一个地方。</p>
          </div>
        </div>

        <section className="about-chapter" style={{ marginTop: 30 }}>
          <div className="eyebrow">Beginning</div>
          <h2>从一张凌晨三点的照片开始</h2>
          <p className="about-copy">
            Nestory 最初不是一份产品计划，而是手机相册里一张凌晨三点的照片。
          </p>
          <p className="about-copy">
            那天孩子刚吃完奶，窗外还很黑。你抱着他坐在床边，忽然意识到：这样的夜晚，一生只有一次。
          </p>
          <p className="about-copy">
            我们想把它留下来。不是留下来多少毫升、多少分钟，而是留下来那个时刻的光、呼吸，和抱着他的人。
          </p>
        </section>

        <section className="about-chapter">
          <div className="eyebrow">The name</div>
          <h2>Nest + Story</h2>
          <p className="about-copy">
            Nest，是巢。是婴儿床、是臂弯、是孩子醒来第一眼看到的地方。
          </p>
          <p className="about-copy">
            Story，是故事。不是成绩单，也不是生长曲线，是某一天他第一次翻身，外婆在视频那头笑出了声。
          </p>
          <p className="about-copy">
            两件东西放在一起，就是这间小屋：它不生产故事，只是把已经发生的，轻轻收好。
          </p>
        </section>

        <section className="about-chapter">
          <div className="eyebrow">What we believe</div>
          <h2>我们相信的三件小事</h2>
          <h3>慢一点，才记得住</h3>
          <p className="about-copy">
            育儿的头一年，总有人在告诉你下一步该做什么。我们更想问：今天有什么值得记住的？一顿吃得格外香的奶，一次睡了四个小时的整觉，都算。
          </p>
          <h3>真实，比完整重要</h3>
          <p className="about-copy">
            漏记一顿奶，不会毁掉什么。亲喂就是分钟，奶瓶就是毫升，我们不做换算，也不替你编一个更好看的数字。
          </p>
          <h3>一家人一起记得</h3>
          <p className="about-copy">
            记忆不该只存在妈妈一个人的手机里。爸爸、外婆、奶奶，都可以写下一句自己的话。等孩子长大，他会知道，自己被很多人同时爱着。
          </p>
        </section>

        <section className="about-chapter">
          <div className="eyebrow">A day in the nest</div>
          <h2>小屋里的一天</h2>
          <div className="about-day">
            {DAYS.map((d) => (
              <div key={d.time} className="about-day__row">
                <time>{d.time}</time>
                <div>
                  <div className="about-day__title">{d.title}</div>
                  <p className="about-day__text">{d.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="about-chapter">
          <div className="eyebrow">A letter</div>
          <h2>写给你的以后</h2>
          <div className="about-letter">
            <p>亲爱的孩子：</p>
            <p>等你读到这些话，也许已经比我们高了。</p>
            <p>
              我们记下这些，不是为了让你知道小时候有多难带，而是想让你知道：你来到这个家的那一天，很多人为你高兴；你第一次翻身的时候，我们真的欢呼了很久。
            </p>
            <p>
              如果有一天你翻看这里，希望你能感觉到，那些普通的下午，也有人认真地爱着你。
            </p>
            <p className="about-letter__sign">—— 爱你的家人</p>
          </div>
        </section>

        <section className="about-chapter">
          <p className="about-copy" style={{ marginBottom: 0 }}>
            所以，Nestory 不是一个育儿报表。它是你们家的一间小屋：门开着，灯亮着，桌上放着一杯凉掉的茶。
          </p>
          <p className="about-sign">Nestory 小团队</p>
        </section>

        <button className="btn btn--quiet btn--full" style={{ marginTop: 26 }} onClick={() => navigate('profile')}>
          回到我的家庭
        </button>

        <p className="about-note">
          Nestory V{APP.version} · {APP.year}
          <br />
          这一版仍在学习，如何做一个安静的容器。
        </p>
      </div>
    </div>
  )
}
